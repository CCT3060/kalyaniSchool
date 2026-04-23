const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureMealSlotTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS meal_type_master (
    id INT AUTO_INCREMENT PRIMARY KEY, meal_name VARCHAR(80) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  await conn.query(`CREATE TABLE IF NOT EXISTS meal_slot_master (
    id INT AUTO_INCREMENT PRIMARY KEY, meal_type_id INT NULL, meal_name VARCHAR(80) NOT NULL,
    amount DECIMAL(10,2) NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_meal_slot_name_time (meal_name, start_time, end_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  // Add meal_type_id column if this is an older table that doesn't have it
  const [msCols] = await conn.query("SHOW COLUMNS FROM meal_slot_master LIKE 'meal_type_id'").catch(() => [[]]);
  if (msCols.length === 0) {
    await conn.query("ALTER TABLE meal_slot_master ADD COLUMN meal_type_id INT NULL AFTER id").catch(() => {});
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS grade_meal_price (
    id INT AUTO_INCREMENT PRIMARY KEY, grade VARCHAR(30) NOT NULL, meal_type_id INT NOT NULL,
    price DECIMAL(10,2) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_grade_meal (grade, meal_type_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  // Add meal_type_id column if this is an older grade_meal_price table that doesn't have it
  const [gpCols] = await conn.query("SHOW COLUMNS FROM grade_meal_price LIKE 'meal_type_id'").catch(() => [[]]);
  if (gpCols.length === 0) {
    await conn.query("ALTER TABLE grade_meal_price ADD COLUMN meal_type_id INT NOT NULL DEFAULT 0 AFTER grade").catch(() => {});
  }
}

// GET /api/meal-slots[?resource=types|prices|slots]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureMealSlotTable(conn);
    const resource = (req.query.resource || 'slots').toLowerCase();

    if (resource === 'types') {
      const [rows] = await conn.query("SELECT id, meal_name, is_active FROM meal_type_master ORDER BY meal_name ASC");
      return res.json({ status: 'success', types: rows });
    }
    if (resource === 'prices') {
      const [rows] = await conn.query(`SELECT gp.id, gp.grade, gp.meal_type_id, mt.meal_name, gp.price, gp.is_active
        FROM grade_meal_price gp INNER JOIN meal_type_master mt ON mt.id=gp.meal_type_id
        ORDER BY CAST(gp.grade AS UNSIGNED), gp.grade, mt.meal_name`);
      return res.json({ status: 'success', prices: rows });
    }
    // slots (default)
    const [rows] = await conn.query(`SELECT ms.id, ms.meal_type_id, COALESCE(mt.meal_name, ms.meal_name) AS meal_name,
      ms.amount, ms.start_time, ms.end_time, ms.is_active
      FROM meal_slot_master ms LEFT JOIN meal_type_master mt ON mt.id=ms.meal_type_id
      ORDER BY ms.start_time ASC`);
    res.json({ status: 'success', slots: rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/meal-slots[?resource=types|prices]
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureMealSlotTable(conn);
    const resource = (req.query.resource || 'slots').toLowerCase();

    if (resource === 'types') {
      const mealName = (req.body.meal_name || '').trim();
      if (!mealName) return res.status(400).json({ status: 'error', message: 'meal_name is required' });
      await conn.query("INSERT INTO meal_type_master (meal_name, is_active) VALUES (?, 1)", [mealName]);
      return res.status(201).json({ status: 'success', message: 'Meal type created successfully' });
    }

    if (resource === 'prices') {
      const { grade, meal_type_id, price } = req.body;
      if (!grade || !meal_type_id || !price) return res.status(400).json({ status: 'error', message: 'grade, meal_type_id and price are required' });
      await conn.query(`INSERT INTO grade_meal_price (grade, meal_type_id, price, is_active) VALUES (?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE price=VALUES(price), is_active=1`, [grade, meal_type_id, parseFloat(price)]);
      return res.json({ status: 'success', message: 'Grade-wise meal price saved' });
    }

    // slots
    let { meal_type_id, meal_name, amount, start_time, end_time } = req.body;
    meal_type_id = parseInt(meal_type_id) || 0;
    if (meal_type_id > 0) {
      const [found] = await conn.query("SELECT meal_name FROM meal_type_master WHERE id=? LIMIT 1", [meal_type_id]);
      if (found.length > 0) meal_name = found[0].meal_name;
    }
    if (!meal_name || !amount || !start_time || !end_time) return res.status(400).json({ status: 'error', message: 'meal_name, amount, start_time, end_time are required' });
    if (start_time >= end_time) return res.status(400).json({ status: 'error', message: 'start_time must be before end_time' });
    await conn.query(`INSERT INTO meal_slot_master (meal_type_id,meal_name,amount,start_time,end_time,is_active) VALUES (?,?,?,?,?,1)`,
      [meal_type_id || null, meal_name, parseFloat(amount), start_time, end_time]);
    res.status(201).json({ status: 'success', message: 'Meal slot created successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ status: 'error', message: 'Already exists' });
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/meal-slots[?resource=types]
router.put('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const resource = (req.query.resource || 'slots').toLowerCase();

    if (resource === 'types') {
      const { id, meal_name, is_active } = req.body;
      if (!id || !meal_name) return res.status(400).json({ status: 'error', message: 'id and meal_name are required' });
      await conn.query("UPDATE meal_type_master SET meal_name=?, is_active=? WHERE id=?", [meal_name, is_active !== undefined ? (is_active ? 1 : 0) : 1, id]);
      await conn.query("UPDATE meal_slot_master SET meal_name=? WHERE meal_type_id=?", [meal_name, id]);
      return res.json({ status: 'success', message: 'Meal type updated' });
    }

    const { id, meal_type_id, meal_name, amount, start_time, end_time, is_active } = req.body;
    if (!id || !meal_name || !amount || !start_time || !end_time) return res.status(400).json({ status: 'error', message: 'id, meal_name, amount, start_time, end_time are required' });
    await conn.query(`UPDATE meal_slot_master SET meal_type_id=?,meal_name=?,amount=?,start_time=?,end_time=?,is_active=? WHERE id=?`,
      [meal_type_id || null, meal_name, parseFloat(amount), start_time, end_time, is_active !== undefined ? (is_active ? 1 : 0) : 1, id]);
    res.json({ status: 'success', message: 'Meal slot updated' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/meal-slots?id=X[&resource=types|prices]
router.delete('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const resource = (req.query.resource || 'slots').toLowerCase();
    const id = parseInt(req.query.id) || 0;
    if (!id) return res.status(400).json({ status: 'error', message: 'id is required' });

    if (resource === 'types') {
      await conn.beginTransaction();
      await conn.query("DELETE FROM grade_meal_price WHERE meal_type_id=?", [id]);
      await conn.query("DELETE FROM meal_slot_master WHERE meal_type_id=?", [id]);
      await conn.query("DELETE FROM meal_type_master WHERE id=?", [id]);
      await conn.commit();
      return res.json({ status: 'success', message: 'Meal type deleted' });
    }
    if (resource === 'prices') {
      await conn.query("DELETE FROM grade_meal_price WHERE id=?", [id]);
      return res.json({ status: 'success', message: 'Grade-wise price deleted' });
    }
    await conn.query("DELETE FROM meal_slot_master WHERE id=?", [id]);
    res.json({ status: 'success', message: 'Meal slot deleted' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
