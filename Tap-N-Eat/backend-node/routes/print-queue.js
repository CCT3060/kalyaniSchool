const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// Simple API key middleware
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || '';
  if (apiKey !== 'print_secret') return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(requireApiKey);

// GET /api/print-queue  — fetch pending jobs and mark them as 'printing'
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [jobs] = await conn.query(
      `SELECT id, employee_name, employee_id, transaction_id,
              meal_type, amount, balance, timestamp, qr_url
       FROM print_queue WHERE status='pending' ORDER BY created_at ASC LIMIT 10`
    );

    if (jobs.length > 0) {
      const ids = jobs.map(j => j.id);
      await conn.query(`UPDATE print_queue SET status='printing' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }

    res.json({ status: 'ok', jobs, count: jobs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/print-queue
router.post('/', async (req, res) => {
  const data = req.body;

  // Update job status
  if (data.job_id !== undefined && data.status !== undefined) {
    try {
      await pool.query(
        `UPDATE print_queue SET status=?, printed_at=NOW(), error_message=? WHERE id=?`,
        [data.status, data.error || null, data.job_id]
      );
      return res.json({ status: 'ok', message: 'Job updated' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Add new print job
  if (data.employee !== undefined && data.transaction !== undefined) {
    const emp = data.employee;
    const txn = data.transaction;
    try {
      const [result] = await pool.query(
        `INSERT INTO print_queue
           (employee_name, employee_id, transaction_id, meal_type, amount, balance, timestamp, qr_url, status)
         VALUES (?,?,?,?,?,?,?,?,'pending')`,
        [emp.name, emp.id, txn.id || null, txn.meal_type, txn.amount, txn.balance, txn.timestamp, data.qr_url || null]
      );
      return res.json({ status: 'ok', job_id: result.insertId, message: 'Print job queued' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(400).json({ error: 'Invalid request data' });
});

module.exports = router;
