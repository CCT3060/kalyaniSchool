const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

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
  if (rows.length === 0) await conn.query("ALTER TABLE transactions ADD COLUMN order_status VARCHAR(20) NOT NULL DEFAULT 'Pending' AFTER transaction_type");
}

async function ensureVisitorOrdersTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS visitor_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    razorpay_order_id VARCHAR(64) UNIQUE, razorpay_payment_id VARCHAR(64) DEFAULT NULL,
    amount INT NOT NULL, currency VARCHAR(8) NOT NULL DEFAULT 'INR',
    meal_slot VARCHAR(50) DEFAULT NULL, qty INT DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'Paid', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});
}

// GET /api/transactions[?employee_id=X&date=Y&meal_category=Z&limit=N&school_id=W]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureOrderStatusColumn(conn);
    await ensureVisitorOrdersTable(conn);

    const employeeId   = req.query.employee_id   || null;
    const date         = req.query.date           || null;
    const mealCategory = req.query.meal_category  || null;
    const limit        = parseInt(req.query.limit || 100);
    const filterSchool = req.query.school_id && !isNaN(req.query.school_id) ? parseInt(req.query.school_id) : null;

    let queryEmp = `SELECT 'employee' AS source, t.id, t.employee_id, t.emp_name, t.emp_id, t.rfid_number,
                    t.transaction_type, t.order_status, t.meal_category, t.amount,
                    t.previous_balance, t.new_balance, t.transaction_date, t.transaction_time,
                    e.site_name, e.shift, t.created_at
                  FROM transactions t LEFT JOIN employees e ON t.employee_id=e.id WHERE 1=1`;
    let queryVis = `SELECT 'visitor' AS source, vo.id, NULL AS employee_id, 'Visitor' AS emp_name,
                    CONCAT('VIS-', LPAD(vo.id, 4, '0')) AS emp_id, NULL AS rfid_number,
                    'visitor' AS transaction_type, vo.status AS order_status, vo.meal_slot AS meal_category,
                    (vo.amount/100) AS amount, NULL AS previous_balance, NULL AS new_balance,
                    DATE(vo.created_at) AS transaction_date, TIME(vo.created_at) AS transaction_time,
                    NULL AS site_name, NULL AS shift, vo.created_at
                  FROM visitor_orders vo WHERE 1=1`;

    const empVals = [], visVals = [];
    if (filterSchool) { queryEmp += ' AND e.school_id=?'; empVals.push(filterSchool); queryVis += ' AND 1=0'; }
    if (employeeId)   { queryEmp += ' AND t.employee_id=?'; empVals.push(employeeId); queryVis += ' AND 1=0'; }
    if (date)         { queryEmp += ' AND t.transaction_date=?'; empVals.push(date); queryVis += ' AND DATE(vo.created_at)=?'; visVals.push(date); }
    if (mealCategory) { queryEmp += ' AND t.meal_category=?'; empVals.push(mealCategory); queryVis += ' AND vo.meal_slot=?'; visVals.push(mealCategory); }

    const finalQuery = `SELECT * FROM ((${queryEmp}) UNION ALL (${queryVis})) AS all_tx
      ORDER BY transaction_date DESC, transaction_time DESC, created_at DESC LIMIT ?`;
    const finalParams = [...empVals, ...visVals, limit];

    const [transactions] = await conn.query(finalQuery, finalParams);
    res.json({ status: 'success', count: transactions.length, transactions });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/transactions  { transaction_id, status: 'Pending'|'Delivered'|'Cancelled' }
router.post('/', async (req, res) => {
  const { transaction_id, id, status } = req.body;
  const txId = transaction_id || id;
  const allowed = ['Pending', 'Delivered', 'Cancelled'];
  if (!txId || !status || !allowed.includes(status)) {
    return res.status(400).json({ status: 'error', message: 'transaction_id and valid status are required', allowed_statuses: allowed });
  }
  try {
    const [result] = await pool.query("UPDATE transactions SET order_status=? WHERE id=?", [status, parseInt(txId)]);
    if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Transaction not found' });
    res.json({ status: 'success', message: 'Transaction status updated' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
