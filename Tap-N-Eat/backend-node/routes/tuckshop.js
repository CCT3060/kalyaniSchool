const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureTuckshopTables(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS tuckshop_items (
    id INT AUTO_INCREMENT PRIMARY KEY, school_id INT DEFAULT NULL,
    item_name VARCHAR(100) NOT NULL, price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    category VARCHAR(50) NOT NULL DEFAULT 'General', is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  await conn.query(`CREATE TABLE IF NOT EXISTS tuckshop_sale_items (
    id INT AUTO_INCREMENT PRIMARY KEY, transaction_id INT NOT NULL, item_id INT DEFAULT NULL,
    item_name VARCHAR(100) NOT NULL, price DECIMAL(10,2) NOT NULL, qty INT NOT NULL DEFAULT 1,
    subtotal DECIMAL(10,2) NOT NULL, INDEX idx_txn (transaction_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
}

// GET /api/tuckshop[?school_id=X]  or  ?action=sales[&school_id=X&from=Y&to=Z&limit=N]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTuckshopTables(conn);
    const action   = req.query.action || '';
    const schoolId = req.query.school_id && !isNaN(req.query.school_id) ? parseInt(req.query.school_id) : null;

    if (action === 'sales') {
      const from  = req.query.from || null;
      const to    = req.query.to   || null;
      const limit = Math.min(parseInt(req.query.limit || 100), 500);

      let q = `SELECT t.id, t.employee_id, t.emp_name, t.emp_id, t.rfid_number,
                      t.amount, t.previous_balance, t.new_balance,
                      t.transaction_date, t.transaction_time, t.created_at
               FROM transactions t WHERE t.transaction_type='tuckshop'`;
      const params = [];
      if (schoolId) { q += ' AND t.school_id=?'; params.push(schoolId); }
      if (from)     { q += ' AND t.transaction_date>=?'; params.push(from); }
      if (to)       { q += ' AND t.transaction_date<=?'; params.push(to); }
      q += ' ORDER BY t.transaction_date DESC, t.transaction_time DESC LIMIT ?';
      params.push(limit);

      const [sales] = await conn.query(q, params);
      if (sales.length > 0) {
        const ids = sales.map(s => parseInt(s.id));
        const [lines] = await conn.query(`SELECT * FROM tuckshop_sale_items WHERE transaction_id IN (${ids.join(',')})`);
        const byTxn = {};
        for (const l of lines) { const k = parseInt(l.transaction_id); byTxn[k] = byTxn[k] || []; byTxn[k].push(l); }
        for (const s of sales) s.items = byTxn[parseInt(s.id)] || [];
      }
      return res.json({ status: 'success', count: sales.length, sales });
    }

    let q = "SELECT * FROM tuckshop_items WHERE is_active=1";
    const params = [];
    if (schoolId) { q += ' AND (school_id=? OR school_id IS NULL)'; params.push(schoolId); }
    q += ' ORDER BY category ASC, item_name ASC';
    const [items] = await conn.query(q, params);
    res.json({ status: 'success', items });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/tuckshop  action=item (create) or action=purchase
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTuckshopTables(conn);
    const action = req.body.action || req.query.action || '';

    if (!action || action === 'item') {
      // Create or update item
      const { id, item_name, price, category, is_active, school_id } = req.body;
      if (!item_name || price === undefined || parseFloat(price) < 0) return res.status(400).json({ status: 'error', message: 'item_name and price are required' });
      const schoolId = school_id && !isNaN(school_id) ? parseInt(school_id) : null;

      if (id) {
        await conn.query("UPDATE tuckshop_items SET item_name=?, price=?, category=?, is_active=? WHERE id=?",
          [item_name.trim(), parseFloat(price), category?.trim() || 'General', is_active !== undefined ? (is_active ? 1 : 0) : 1, parseInt(id)]);
        return res.json({ status: 'success', message: 'Item updated' });
      }
      const [result] = await conn.query("INSERT INTO tuckshop_items (school_id, item_name, price, category, is_active) VALUES (?,?,?,?,1)",
        [schoolId, item_name.trim(), parseFloat(price), category?.trim() || 'General']);
      return res.status(201).json({ status: 'success', message: 'Item created', id: result.insertId });
    }

    if (action === 'purchase') {
      const { rfid_number, school_id, items } = req.body;
      if (!rfid_number || !Array.isArray(items) || items.length === 0) return res.status(400).json({ status: 'error', message: 'rfid_number and items array are required' });
      const schoolId = school_id && !isNaN(school_id) ? parseInt(school_id) : null;

      await conn.beginTransaction();

      let empQ = "SELECT * FROM employees WHERE rfid_number=?";
      const empParams = [rfid_number];
      if (schoolId) { empQ += ' AND school_id=?'; empParams.push(schoolId); }
      const [empRows] = await conn.query(empQ, empParams);
      if (empRows.length === 0) { await conn.rollback(); return res.status(404).json({ status: 'error', message: 'Employee not found' }); }
      const emp = empRows[0];

      const total = items.reduce((s, i) => s + (parseFloat(i.price) * parseInt(i.qty || 1)), 0);
      const prevBalance = parseFloat(emp.wallet_amount || 0);
      if (prevBalance < total) { await conn.rollback(); return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance', required: total, available: prevBalance }); }
      const newBalance = prevBalance - total;

      await conn.query("UPDATE employees SET wallet_amount=? WHERE id=?", [newBalance, emp.id]);

      const dateObj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const [txResult] = await conn.query(
        `INSERT INTO transactions (employee_id, school_id, rfid_number, emp_id, emp_name, transaction_type, order_status,
          meal_category, amount, previous_balance, new_balance, transaction_time, transaction_date)
         VALUES (?, ?, ?, ?, ?, 'tuckshop', 'Completed', 'Tuckshop Purchase', ?, ?, ?, ?, ?)`,
        [emp.id, schoolId, emp.rfid_number, emp.emp_id, emp.emp_name, total, prevBalance, newBalance,
         dateObj.toTimeString().split(' ')[0], dateObj.toISOString().split('T')[0]]
      );
      const txId = txResult.insertId;

      for (const item of items) {
        const qty      = parseInt(item.qty || 1);
        const price    = parseFloat(item.price);
        const subtotal = price * qty;
        await conn.query("INSERT INTO tuckshop_sale_items (transaction_id, item_id, item_name, price, qty, subtotal) VALUES (?,?,?,?,?,?)",
          [txId, item.id || null, item.name || item.item_name || 'Unknown', price, qty, subtotal]);
      }

      await conn.commit();
      return res.json({
        status: 'success', message: 'Purchase processed',
        transaction: { id: txId, total, previous_balance: prevBalance, new_balance: newBalance },
        employee: { name: emp.emp_name, emp_id: emp.emp_id, wallet_balance: newBalance }
      });
    }

    res.status(400).json({ status: 'error', message: 'Invalid action' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/tuckshop
router.put('/', async (req, res) => {
  const { id, item_name, price, category, is_active } = req.body;
  if (!id || !item_name || price === undefined || parseFloat(price) < 0) return res.status(400).json({ status: 'error', message: 'id, item_name and price are required' });
  try {
    await pool.query("UPDATE tuckshop_items SET item_name=?, price=?, category=?, is_active=? WHERE id=?",
      [item_name.trim(), parseFloat(price), category?.trim() || 'General', is_active !== undefined ? (is_active ? 1 : 0) : 1, parseInt(id)]);
    res.json({ status: 'success', message: 'Item updated' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/tuckshop?id=X
router.delete('/', async (req, res) => {
  const id = parseInt(req.query.id || req.body?.id || 0);
  if (!id) return res.status(400).json({ status: 'error', message: 'Item id required' });
  try {
    await pool.query("UPDATE tuckshop_items SET is_active=0 WHERE id=?", [id]);
    res.json({ status: 'success', message: 'Item removed' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
