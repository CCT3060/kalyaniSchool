const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

function pickVal(obj, keys, def = null) {
  if (!obj) return def;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return def;
}

async function ensureTransactionsTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NULL,
    school_id INT NULL,
    rfid_number VARCHAR(64) NULL,
    emp_id VARCHAR(64) NULL,
    emp_name VARCHAR(120) NULL,
    transaction_type VARCHAR(30) NOT NULL DEFAULT 'deduction',
    order_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    meal_category VARCHAR(80) NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    new_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    transaction_time TIME NULL,
    transaction_date DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_txn_emp (employee_id),
    INDEX idx_txn_school (school_id),
    INDEX idx_txn_date (transaction_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function ensureOrderStatusColumn(conn) {
  await ensureTransactionsTable(conn);
  const [rows] = await conn.query("SHOW COLUMNS FROM transactions LIKE 'order_status'");
  if (rows.length === 0) {
    await conn.query("ALTER TABLE transactions ADD COLUMN order_status VARCHAR(20) NOT NULL DEFAULT 'Pending' AFTER transaction_type");
  }
}

async function ensureMealSlotMaster(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS meal_slot_master (
    id INT AUTO_INCREMENT PRIMARY KEY, meal_name VARCHAR(80) NOT NULL,
    amount DECIMAL(10,2) NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_meal_slot_name_time (meal_name, start_time, end_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  await conn.query(`CREATE TABLE IF NOT EXISTS grade_meal_price (
    id INT AUTO_INCREMENT PRIMARY KEY, grade VARCHAR(30) NOT NULL, meal_name VARCHAR(80) NOT NULL,
    price DECIMAL(10,2) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_grade_meal_name (grade, meal_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  // Ensure meal_subscriptions and canteen_access_log tables
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

  await conn.query(`CREATE TABLE IF NOT EXISTS canteen_access_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL, school_id INT NULL,
    rfid_number VARCHAR(64) NULL, emp_id VARCHAR(64) NULL, emp_name VARCHAR(120) NULL,
    meal_type_id INT NULL, meal_type_name VARCHAR(80) NULL,
    subscription_id INT NULL,
    access_status VARCHAR(20) NOT NULL DEFAULT 'Allowed',
    deny_reason VARCHAR(200) NULL,
    access_date DATE NOT NULL, access_time TIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cal_student (student_id), INDEX idx_cal_date (access_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
}

async function getMealCategory(conn, timeStr = null) {
  const now = timeStr || new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });

  try {
    const [slots] = await conn.query(
      `SELECT meal_name, amount, start_time, end_time FROM meal_slot_master
       WHERE is_active=1 AND ? BETWEEN start_time AND end_time ORDER BY start_time ASC LIMIT 1`,
      [now]
    );
    if (slots.length > 0) {
      return { category: slots[0].meal_name, amount: parseFloat(slots[0].amount), slot_source: 'master' };
    }
  } catch (e) { /* fallback */ }

  const [h, m] = now.split(':').map(Number);
  const total  = h * 60 + m;
  if (total >= 360  && total < 720)  return { category: 'Breakfast', amount: 20, time_slot: '6:00 AM - 12:00 PM' };
  if (total >= 720  && total < 780)  return { category: 'Mid-Meal',  amount: 30, time_slot: '12:00 PM - 1:00 PM' };
  if (total >= 780  && total < 900)  return { category: 'Lunch',     amount: 50, time_slot: '1:00 PM - 3:00 PM'  };
  if (total >= 900  && total < 1080) return { category: 'Snack',     amount: 30, time_slot: '3:00 PM - 6:00 PM'  };
  if (total >= 1080 && total < 1260) return { category: 'Dinner',    amount: 50, time_slot: '6:00 PM - 9:00 PM'  };
  return { category: null, amount: 0, time_slot: 'Outside meal hours', error: 'Current time is not within any meal slot' };
}

async function applyGradeWisePrice(conn, mealInfo, grade) {
  if (!mealInfo || !mealInfo.category || !grade) return mealInfo;
  try {
    // Try direct grade+meal_name match
    const [rows] = await conn.query(
      "SELECT price FROM grade_meal_price WHERE is_active=1 AND grade=? AND meal_name=? LIMIT 1",
      [grade, mealInfo.category]
    );
    if (rows.length > 0) {
      return { ...mealInfo, amount: parseFloat(rows[0].price), price_source: 'grade_override' };
    }
    // Try via meal_type_master join
    const [rows2] = await conn.query(
      `SELECT gp.price FROM grade_meal_price gp
       INNER JOIN meal_type_master mt ON mt.id=gp.meal_type_id
       WHERE gp.is_active=1 AND gp.grade=? AND mt.meal_name=? LIMIT 1`,
      [grade, mealInfo.category]
    );
    if (rows2.length > 0) {
      return { ...mealInfo, amount: parseFloat(rows2[0].price), price_source: 'grade_override' };
    }
  } catch (e) { /* fallback */ }
  return mealInfo;
}

// GET /api/rfid-scan[?time=HH:MM:SS]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureMealSlotMaster(conn);
    const mealInfo = await getMealCategory(conn, req.query.time || null);
    const now = new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });
    res.json({ current_time: now, meal_info: mealInfo });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/rfid-scan  { rfid_number, school_id? }
// Canteen RFID scan — checks active meal plan subscription, NO wallet deduction.
router.post('/', async (req, res) => {
  const { rfid_number, school_id } = req.body;
  if (!rfid_number) return res.status(400).json({ status: 'error', message: 'RFID number is required' });

  const scanSchoolId = school_id && !isNaN(school_id) ? parseInt(school_id) : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrderStatusColumn(conn);
    await ensureMealSlotMaster(conn);

    // Ensure school_id column on transactions
    const [scChk] = await conn.query("SHOW COLUMNS FROM transactions LIKE 'school_id'");
    if (scChk.length === 0) await conn.query("ALTER TABLE transactions ADD COLUMN school_id INT NULL AFTER employee_id");

    // Lookup employee/student
    let empQuery = "SELECT * FROM employees WHERE rfid_number=?";
    const empParams = [rfid_number];
    if (scanSchoolId) { empQuery += ' AND school_id=?'; empParams.push(scanSchoolId); }
    const [empRows] = await conn.query(empQuery, empParams);

    if (empRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Student not found', rfid: rfid_number });
    }

    const employee = empRows[0];
    const employeeId     = parseInt(employee.id);
    const employeeName   = String(pickVal(employee, ['emp_name', 'full_name', 'name'], 'Unknown'));
    const employeeCode   = String(pickVal(employee, ['emp_id', 'admission_no'], ''));
    const employeeSite   = String(pickVal(employee, ['site_name', 'site', 'section_name', 'division'], ''));
    const employeeGrade  = String(pickVal(employee, ['grade', 'shift'], ''));
    const employeeRfid   = String(pickVal(employee, ['rfid_number', 'rfid_uid'], rfid_number));

    if (!employeeId) {
      await conn.rollback();
      return res.status(500).json({ status: 'error', message: 'Invalid employee record: missing id' });
    }

    const dateObj     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentDate = dateObj.toISOString().split('T')[0];
    const currentTime = dateObj.toTimeString().split(' ')[0]; // HH:MM:SS
    const currentMonth = dateObj.getMonth() + 1; // 1-12
    const currentYear  = dateObj.getFullYear();

    // Get student's active subscriptions for this month/year, joined with category timing
    const [allSubs] = await conn.query(
      `SELECT ms.id, ms.meal_type_id, ms.meal_type_name,
              mc.start_time, mc.end_time
       FROM meal_subscriptions ms
       LEFT JOIN monthly_meal_plans mmp ON (
         mmp.meal_type_id = ms.meal_type_id
         AND mmp.month = ms.month
         AND mmp.year = ms.year
         AND (mmp.school_id = ? OR mmp.school_id IS NULL)
       )
       LEFT JOIN meal_categories mc ON mc.id = mmp.category_id AND mc.is_active = 1
       WHERE ms.student_id = ?
         AND ms.month = ?
         AND ms.year = ?
         AND ms.status = 'Active'`,
      [scanSchoolId, employeeId, currentMonth, currentYear]
    );

    let matchedSub = null;
    let denyReason = null;

    if (allSubs.length === 0) {
      denyReason = `No active meal plan subscription found for ${currentMonth}/${currentYear}`;
    } else {
      // Find a subscription whose timing window covers the current time
      matchedSub = allSubs.find((s) => {
        if (!s.start_time || !s.end_time) return true; // no timing set = always accessible
        return currentTime >= s.start_time && currentTime <= s.end_time;
      });
      if (!matchedSub) {
        const windows = allSubs
          .filter((s) => s.start_time && s.end_time)
          .map((s) => `${s.meal_type_name} (${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)})`)
          .join(', ');
        denyReason = `Current time (${currentTime.slice(0,5)}) is outside your plan timing. Your plan(s): ${windows || 'timing not set'}`;
      }
    }

    const logStatus      = matchedSub ? 'Allowed' : 'Denied';
    const subscriptionId = matchedSub ? matchedSub.id : null;
    const mealTypeName   = matchedSub ? matchedSub.meal_type_name : (allSubs[0]?.meal_type_name || 'Unknown');
    const mealTypeId     = matchedSub ? matchedSub.meal_type_id : (allSubs[0]?.meal_type_id || null);

    await conn.query(
      `INSERT INTO canteen_access_log
         (student_id, school_id, rfid_number, emp_id, emp_name,
          meal_type_id, meal_type_name, subscription_id,
          access_status, deny_reason, access_date, access_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, scanSchoolId, employeeRfid, employeeCode, employeeName,
       mealTypeId, mealTypeName, subscriptionId,
       logStatus, denyReason, currentDate, currentTime]
    );

    if (!matchedSub) {
      // Denied — insert a 'denied' transaction record so parent can see it
      await conn.query(
        `INSERT INTO transactions
           (employee_id, school_id, rfid_number, emp_id, emp_name, transaction_type, order_status,
            meal_category, amount, previous_balance, new_balance, transaction_time, transaction_date)
         VALUES (?, ?, ?, ?, ?, 'canteen_denied', 'Denied', ?, 0, 0, 0, ?, ?)`,
        [employeeId, scanSchoolId, employeeRfid, employeeCode, employeeName,
         mealTypeName, currentTime, currentDate]
      );

      await conn.commit();
      return res.status(403).json({
        status: 'error',
        message: denyReason,
        deny_reason: denyReason,
        employee: { name: employeeName, emp_id: employeeCode, grade: employeeGrade }
      });
    }

    // Allowed — log as canteen access in transactions (no wallet change)
    const walletBalance = parseFloat(pickVal(employee, ['wallet_amount', 'wallet_balance'], 0));
    await conn.query(
      `INSERT INTO transactions
         (employee_id, school_id, rfid_number, emp_id, emp_name, transaction_type, order_status,
          meal_category, amount, previous_balance, new_balance, transaction_time, transaction_date)
       VALUES (?, ?, ?, ?, ?, 'canteen', 'Completed', ?, 0, ?, ?, ?, ?)`,
      [employeeId, scanSchoolId, employeeRfid, employeeCode, employeeName,
       mealTypeName, walletBalance, walletBalance, currentTime, currentDate]
    );

    await conn.commit();
    res.json({
      status: 'success',
      message: 'Canteen access granted',
      employee: {
        name: employeeName, emp_id: employeeCode,
        site: employeeSite, grade: employeeGrade
      },
      transaction: {
        meal_plan: mealTypeName,
        meal_category: mealTypeName,
        access: 'Allowed',
        subscription_id: subscriptionId,
        time: currentTime,
        date: currentDate
      }
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ status: 'error', message: 'Scan failed: ' + err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
