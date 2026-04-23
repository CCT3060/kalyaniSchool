const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

function buildQrUrl(transactionId) {
  let rawBase = process.env.QSR_PUBLIC_BASE || '';
  rawBase = rawBase.replace(/\/frontend.*$/i, '');
  rawBase = rawBase.replace(/(\/Tap-N-Eat)+/i, '/Tap-N-Eat');
  const base = rawBase.replace(/\/+$/, '');
  return base ? `${base}/receipt.php?id=${transactionId}` : null;
}

// POST /api/print-thermal
router.post('/', async (req, res) => {
  const payload = req.body;
  if (!payload.employee || !payload.transaction) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const emp = payload.employee;
  const txn = payload.transaction;
  const empName  = emp.emp_name  || emp.name  || 'Unknown';
  const empId    = emp.emp_id    || emp.id    || 'Unknown';
  const mealType = emp.meal_category || txn.meal_type || txn.meal_category || 'Unknown';
  const amount   = emp.amount    || txn.amount_deducted || txn.amount || 0;
  const balance  = emp.balance   || txn.new_balance     || txn.balance || 0;

  const now = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour12: false });
  let timestamp = now.replace(', ', ' ');
  if (emp.date && emp.time) timestamp = `${emp.date} ${emp.time}`;

  const qrUrl = buildQrUrl(txn.id);

  try {
    const [result] = await pool.query(
      `INSERT INTO print_queue
         (employee_name, employee_id, transaction_id, meal_type, amount, balance, timestamp, qr_url, status)
       VALUES (?,?,?,?,?,?,?,?,'pending')`,
      [empName, empId, txn.id || null, mealType, amount, balance, timestamp, qrUrl]
    );
    res.json({ status: 'success', mode: 'network', message: 'Print job queued successfully', qr_url: qrUrl, job_id: result.insertId });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
