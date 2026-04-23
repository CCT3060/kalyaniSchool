const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// POST /api/print-receipt  { transaction_id }
router.post('/', async (req, res) => {
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ status: 'error', message: 'Transaction ID required' });

  try {
    const [txRows] = await pool.query(
      `SELECT t.*, e.emp_name, e.emp_id, e.site_name, e.shift
       FROM transactions t LEFT JOIN employees e ON t.employee_id = e.id
       WHERE t.id=?`,
      [transaction_id]
    );
    if (txRows.length === 0) return res.status(404).json({ status: 'error', message: 'Transaction not found' });
    const transaction = txRows[0];

    const [empRows] = await pool.query('SELECT * FROM employees WHERE id=?', [transaction.employee_id]);
    if (empRows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' });
    const employee = empRows[0];

    const receiptEmployee = { name: employee.emp_name, emp_id: employee.emp_id, site: employee.site_name };
    const receiptTransaction = {
      id: transaction.id,
      meal_category: transaction.meal_category,
      time: transaction.transaction_time,
      date: transaction.transaction_date,
      amount: parseFloat(transaction.amount).toFixed(2),
      balance: parseFloat(transaction.new_balance).toFixed(2),
    };

    // Queue for printing via print_queue table
    const qrBase = (process.env.QSR_PUBLIC_BASE || '').replace(/\/+$/, '');
    const qrUrl  = qrBase ? `${qrBase}/receipt.php?id=${transaction.id}` : null;

    const [result] = await pool.query(
      `INSERT INTO print_queue
         (employee_name, employee_id, transaction_id, meal_type, amount, balance, timestamp, qr_url, status)
       VALUES (?,?,?,?,?,?,?,?,'pending')`,
      [receiptEmployee.name, receiptEmployee.emp_id, transaction.id,
       receiptTransaction.meal_category, receiptTransaction.amount, receiptTransaction.balance,
       `${receiptTransaction.date} ${receiptTransaction.time}`, qrUrl]
    );

    res.json({
      status: 'success',
      message: 'Receipt queued for printing',
      print: { job_id: result.insertId, employee: receiptEmployee, transaction: receiptTransaction, qr_url: qrUrl },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
