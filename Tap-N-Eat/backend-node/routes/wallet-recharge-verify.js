const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const pool    = require('../config/database');

async function ensureWalletRechargePaymentsTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS wallet_recharge_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    school_id INT NULL,
    razorpay_order_id VARCHAR(64) NOT NULL,
    razorpay_payment_id VARCHAR(64) NOT NULL,
    meal_type_id INT NULL,
    meal_type_name VARCHAR(80) NULL,
    payment_for VARCHAR(20) NOT NULL DEFAULT 'Canteen',
    payment_months TEXT NULL,
    payment_year SMALLINT NOT NULL,
    sub_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    convenience_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    amount_credited DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'Completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_razorpay_payment (razorpay_payment_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// POST /api/wallet-recharge-verify
router.post('/', async (req, res) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return res.status(500).json({ verified: false, message: 'Razorpay key secret not configured' });

  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ verified: false, message: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });
  }

  // Verify HMAC
  const expectedSig = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  if (expectedSig !== signature) {
    return res.status(400).json({ verified: false, message: 'Payment signature verification failed' });
  }

  const studentId  = parseInt(req.body.student_id) || 0;
  const email      = (req.body.email || '').trim().toLowerCase();
  const amountPaid = parseFloat(req.body.amount_paid) || 0;
  const subTotal   = parseFloat(req.body.sub_total) || 0;
  const mealTypeId = parseInt(req.body.meal_type_id) || 0;
  const mealName   = (req.body.meal_type_name || '').trim();
  const months     = Array.isArray(req.body.months) ? req.body.months : [];
  const year       = parseInt(req.body.year) || new Date().getFullYear();
  const paymentFor = (req.body.payment_for || 'Canteen').trim();

  const isTuckShop = paymentFor === 'TuckShop';
  if (studentId <= 0 || !email || amountPaid <= 0 || (!isTuckShop && months.length === 0)) {
    return res.status(400).json({ verified: false, message: 'student_id, email, amount_paid and (for meal plans) months are required' });
  }

  const conn = await pool.getConnection();
  try {
    await ensureWalletRechargePaymentsTable(conn);
    // Ensure meal_subscriptions table exists
    await conn.query(`CREATE TABLE IF NOT EXISTS meal_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL, school_id INT NULL,
      meal_type_id INT NOT NULL, meal_type_name VARCHAR(80) NOT NULL,
      month TINYINT NOT NULL, year SMALLINT NOT NULL, grade VARCHAR(30) NULL,
      amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00, razorpay_payment_id VARCHAR(64) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Active',
      subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ms_student (student_id),
      UNIQUE KEY uq_student_plan (student_id, meal_type_id, month, year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

    // Check duplicate
    const [dupRows] = await conn.query('SELECT id FROM wallet_recharge_payments WHERE razorpay_payment_id=? LIMIT 1', [paymentId]);
    if (dupRows.length > 0) {
      conn.release();
      return res.status(409).json({ verified: false, message: 'Payment already processed' });
    }

    // Verify student ownership by parent email
    const [stuRows] = await conn.query(
      'SELECT id, school_id, emp_id, emp_name, rfid_number, wallet_amount, grade FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=? LIMIT 1',
      [studentId, email]
    );
    if (stuRows.length === 0) {
      conn.release();
      return res.status(404).json({ verified: false, message: 'Student not found for this parent' });
    }
    const student = stuRows[0];
    const convenienceFee = Math.round((amountPaid - subTotal) * 100) / 100;

    await conn.beginTransaction();

    const monthNames  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthLabels = months.map(m => monthNames[(m - 1)] || m);
    const now = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour12: false });
    const [datePart, timePart] = now.split(', ');

    if (isTuckShop) {
      // TuckShop: credit wallet as before
      const previousBalance = parseFloat(student.wallet_amount) || 0;
      const creditAmount    = subTotal;
      const newBalance      = previousBalance + creditAmount;

      await conn.query('UPDATE employees SET wallet_amount=? WHERE id=?', [newBalance, studentId]);

      await conn.query(
        `INSERT INTO wallet_recharge_payments
          (student_id, school_id, razorpay_order_id, razorpay_payment_id,
           meal_type_id, meal_type_name, payment_for, payment_months, payment_year,
           sub_total, convenience_fee, total_paid, amount_credited, payment_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Completed')`,
        [studentId, student.school_id || null, orderId, paymentId,
         null, 'TuckShop', paymentFor, '[]', year,
         subTotal, convenienceFee, amountPaid, creditAmount]
      );

      await conn.query(
        `INSERT INTO transactions
          (employee_id, school_id, rfid_number, emp_id, emp_name,
           transaction_type, order_status, meal_category, amount,
           previous_balance, new_balance, transaction_time, transaction_date)
         VALUES (?,?,?,?,?,'recharge','Completed','TuckShop Wallet Top-Up',?,?,?,?,?)`,
        [studentId, student.school_id || null, student.rfid_number, student.emp_id, student.emp_name,
         creditAmount, previousBalance, newBalance, timePart, datePart]
      );

      await conn.commit();
      return res.json({
        verified: true,
        message: 'TuckShop wallet topped up successfully',
        amount_credited: creditAmount,
        new_balance: newBalance,
        payment_id: paymentId,
        payment_for: 'TuckShop'
      });
    }

    // Canteen/Meal Plan: create subscriptions, do NOT credit wallet
    const grade = student.grade || null;
    const perMonthAmount = months.length > 0 ? Math.round((subTotal / months.length) * 100) / 100 : subTotal;

    const createdSubs = [];
    for (const month of months) {
      const [result] = await conn.query(
        `INSERT INTO meal_subscriptions
           (student_id, school_id, meal_type_id, meal_type_name, month, year, grade, amount_paid, razorpay_payment_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
         ON DUPLICATE KEY UPDATE
           status = 'Active',
           amount_paid = VALUES(amount_paid),
           razorpay_payment_id = VALUES(razorpay_payment_id),
           subscribed_at = NOW()`,
        [studentId, student.school_id || null, mealTypeId, mealName, month, year,
         grade, perMonthAmount, paymentId]
      );
      createdSubs.push({ month, meal_type_name: mealName, id: result.insertId || 0 });
    }

    await conn.query(
      `INSERT INTO wallet_recharge_payments
        (student_id, school_id, razorpay_order_id, razorpay_payment_id,
         meal_type_id, meal_type_name, payment_for, payment_months, payment_year,
         sub_total, convenience_fee, total_paid, amount_credited, payment_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Completed')`,
      [studentId, student.school_id || null, orderId, paymentId,
       mealTypeId || null, mealName || null, paymentFor, JSON.stringify(months), year,
       subTotal, convenienceFee, amountPaid, 0]
    );

    const category = `${mealName || 'Meal Plan'} - ${monthLabels.join(', ')} (Subscription)`;
    const currentBalance = parseFloat(student.wallet_amount) || 0;
    await conn.query(
      `INSERT INTO transactions
        (employee_id, school_id, rfid_number, emp_id, emp_name,
         transaction_type, order_status, meal_category, amount,
         previous_balance, new_balance, transaction_time, transaction_date)
       VALUES (?,?,?,?,?,'meal_subscription','Completed',?,?,?,?,?,?)`,
      [studentId, student.school_id || null, student.rfid_number, student.emp_id, student.emp_name,
       category, subTotal, currentBalance, currentBalance, timePart, datePart]
    );

    await conn.commit();
    res.json({
      verified: true,
      message: `Meal plan subscription activated for ${monthLabels.join(', ')}`,
      subscriptions_created: createdSubs.length,
      subscriptions: createdSubs,
      payment_id: paymentId,
      payment_for: paymentFor
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ verified: false, message: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
