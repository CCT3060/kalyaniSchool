const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureTables(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS meal_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    school_id INT NULL,
    meal_type_id INT NOT NULL,
    meal_type_name VARCHAR(80) NOT NULL,
    month TINYINT NOT NULL,
    year SMALLINT NOT NULL,
    grade VARCHAR(30) NULL,
    amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    razorpay_payment_id VARCHAR(64) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Active',
    subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ms_student (student_id),
    INDEX idx_ms_school (school_id),
    UNIQUE KEY uq_student_plan (student_id, meal_type_id, month, year)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  await conn.query(`CREATE TABLE IF NOT EXISTS canteen_access_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    school_id INT NULL,
    rfid_number VARCHAR(64) NULL,
    emp_id VARCHAR(64) NULL,
    emp_name VARCHAR(120) NULL,
    meal_type_id INT NULL,
    meal_type_name VARCHAR(80) NULL,
    subscription_id INT NULL,
    access_status VARCHAR(20) NOT NULL DEFAULT 'Allowed',
    deny_reason VARCHAR(200) NULL,
    access_date DATE NOT NULL,
    access_time TIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cal_student (student_id),
    INDEX idx_cal_date (access_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
}

/**
 * GET /api/meal-plan-subscriptions
 *   ?action=list&student_id=X              => student's subscriptions (parent view)
 *   ?action=report[&school_id=Z&month=M&year=Y]  => admin subscription report
 *   ?action=access-log&student_id=X[&limit=N]    => canteen access log for a student
 */
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTables(conn);
    const action = req.query.action || 'list';

    if (action === 'list') {
      const studentId = parseInt(req.query.student_id || 0);
      if (!studentId) return res.status(400).json({ error: 'student_id is required' });

      const [rows] = await conn.query(
        `SELECT id, meal_type_id, meal_type_name, month, year, grade, amount_paid, status, subscribed_at
         FROM meal_subscriptions
         WHERE student_id = ?
         ORDER BY year DESC, month DESC, meal_type_name ASC`,
        [studentId]
      );
      return res.json({ subscriptions: rows });
    }

    if (action === 'report') {
      const schoolId = req.query.school_id ? parseInt(req.query.school_id) : null;
      const month    = req.query.month ? parseInt(req.query.month) : null;
      const year     = req.query.year  ? parseInt(req.query.year)  : new Date().getFullYear();

      let sql = `SELECT ms.id, ms.student_id, e.emp_name AS student_name, e.emp_id AS student_code,
                        e.grade, e.division, ms.meal_type_id, ms.meal_type_name,
                        ms.month, ms.year, ms.amount_paid, ms.status, ms.subscribed_at,
                        s.school_name
                 FROM meal_subscriptions ms
                 JOIN employees e ON e.id = ms.student_id
                 LEFT JOIN schools s ON s.id = ms.school_id
                 WHERE ms.year = ?`;
      const params = [year];
      if (schoolId) { sql += ' AND ms.school_id = ?'; params.push(schoolId); }
      if (month)    { sql += ' AND ms.month = ?';     params.push(month); }
      sql += ' ORDER BY e.emp_name ASC, ms.month ASC, ms.meal_type_name ASC';

      const [rows] = await conn.query(sql, params);
      return res.json({ report: rows, total: rows.length });
    }

    if (action === 'access-log') {
      const studentId = parseInt(req.query.student_id || 0);
      if (!studentId) return res.status(400).json({ error: 'student_id is required' });
      const limit = Math.min(parseInt(req.query.limit || 50), 200);

      const [rows] = await conn.query(
        `SELECT id, meal_type_name, access_status, deny_reason, access_date, access_time, created_at
         FROM canteen_access_log
         WHERE student_id = ?
         ORDER BY access_date DESC, access_time DESC
         LIMIT ?`,
        [studentId, limit]
      );
      return res.json({ access_log: rows });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/meal-plan-subscriptions
 * Create subscription records after Razorpay payment is verified.
 * Body: {
 *   student_id, school_id, grade,
 *   subscriptions: [{ meal_type_id, meal_type_name, month, year, amount_paid }],
 *   razorpay_payment_id
 * }
 */
router.post('/', async (req, res) => {
  const { student_id, school_id, grade, subscriptions, razorpay_payment_id } = req.body;
  if (!student_id || !Array.isArray(subscriptions) || subscriptions.length === 0) {
    return res.status(400).json({ error: 'student_id and subscriptions array are required' });
  }

  const conn = await pool.getConnection();
  try {
    await ensureTables(conn);
    await conn.beginTransaction();

    const created = [];
    for (const sub of subscriptions) {
      const { meal_type_id, meal_type_name, month, year, amount_paid } = sub;
      if (!meal_type_id || !month || !year) continue;

      const [result] = await conn.query(
        `INSERT INTO meal_subscriptions
           (student_id, school_id, meal_type_id, meal_type_name, month, year, grade, amount_paid, razorpay_payment_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
         ON DUPLICATE KEY UPDATE
           status = 'Active',
           amount_paid = VALUES(amount_paid),
           razorpay_payment_id = VALUES(razorpay_payment_id),
           subscribed_at = NOW()`,
        [student_id, school_id || null, meal_type_id, meal_type_name, month, year,
         grade || null, parseFloat(amount_paid) || 0, razorpay_payment_id || null]
      );
      created.push({ meal_type_name, month, year, id: result.insertId || 0 });
    }

    await conn.commit();
    res.json({ message: `${created.length} subscription(s) created/renewed`, subscriptions: created });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
