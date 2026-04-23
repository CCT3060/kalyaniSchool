const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// GET /api/wallet-recharge?search=RFID_OR_EMP_ID[&school_id=X]
router.get('/', async (req, res) => {
  const { search, school_id } = req.query;
  if (!search) return res.status(400).json({ message: 'Search parameter required' });
  const schoolId = school_id && !isNaN(school_id) ? parseInt(school_id) : null;

  let q = "SELECT * FROM employees WHERE (rfid_number=? OR emp_id=?)";
  const params = [search, search];
  if (schoolId) { q += ' AND school_id=?'; params.push(schoolId); }

  try {
    const [rows] = await pool.query(q, params);
    if (rows.length === 0) return res.status(404).json({ message: 'Employee not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/wallet-recharge
router.post('/', async (req, res) => {
  const schoolId = req.body.school_id && !isNaN(req.body.school_id) ? parseInt(req.body.school_id) : null;

  // Bulk recharge
  if (req.body.bulk_recharge === true) {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ message: 'Amount is required' });
    let q = "UPDATE employees SET wallet_amount=wallet_amount+?";
    const params = [parseFloat(amount)];
    if (schoolId) { q += ' WHERE school_id=?'; params.push(schoolId); }
    try {
      const [result] = await pool.query(q, params);
      return res.json({ message: 'Bulk recharge successful', employees_recharged: result.affectedRows, amount_added: parseFloat(amount) });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }

  // Single employee recharge
  const { employee_id, amount } = req.body;
  if (!employee_id || !amount) return res.status(400).json({ message: 'Invalid request data' });

  try {
    const [result] = await pool.query("UPDATE employees SET wallet_amount=wallet_amount+? WHERE id=?", [parseFloat(amount), parseInt(employee_id)]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Employee not found' });
    const [empRows] = await pool.query("SELECT * FROM employees WHERE id=?", [parseInt(employee_id)]);
    res.json({ message: 'Wallet recharged successfully', employee: empRows[0], amount_added: parseFloat(amount) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
