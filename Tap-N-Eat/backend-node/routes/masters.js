const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureMasterTables(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS grade_master (
    id INT AUTO_INCREMENT PRIMARY KEY, school_id INT NULL, value VARCHAR(30) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await conn.query(`CREATE TABLE IF NOT EXISTS division_master (
    id INT AUTO_INCREMENT PRIMARY KEY, school_id INT NULL, value VARCHAR(30) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  for (const tbl of ['grade_master', 'division_master']) {
    const [chk] = await conn.query(`SHOW COLUMNS FROM ${tbl} LIKE 'school_id'`);
    if (chk.length === 0) await conn.query(`ALTER TABLE ${tbl} ADD COLUMN school_id INT NULL AFTER id`);
  }

  await conn.query(`INSERT IGNORE INTO grade_master (school_id, value) VALUES
    (NULL,'1'),(NULL,'2'),(NULL,'3'),(NULL,'4'),(NULL,'5'),(NULL,'6'),
    (NULL,'7'),(NULL,'8'),(NULL,'9'),(NULL,'10'),(NULL,'11'),(NULL,'12')`);
  await conn.query(`INSERT IGNORE INTO division_master (school_id, value) VALUES
    (NULL,'A'),(NULL,'B'),(NULL,'C'),(NULL,'D')`);
}

// GET /api/masters[?school_id=X]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureMasterTables(conn);
    const schoolId = req.query.school_id && !isNaN(req.query.school_id) ? parseInt(req.query.school_id) : null;
    let grades, divisions;
    if (schoolId) {
      [grades]    = await conn.query("SELECT id, value FROM grade_master WHERE is_active=1 AND (school_id IS NULL OR school_id=?) ORDER BY CAST(value AS UNSIGNED), value", [schoolId]);
      [divisions] = await conn.query("SELECT id, value FROM division_master WHERE is_active=1 AND (school_id IS NULL OR school_id=?) ORDER BY value", [schoolId]);
    } else {
      [grades]    = await conn.query("SELECT id, value FROM grade_master WHERE is_active=1 ORDER BY CAST(value AS UNSIGNED), value");
      [divisions] = await conn.query("SELECT id, value FROM division_master WHERE is_active=1 ORDER BY value");
    }
    res.json({ status: 'success', grades, divisions });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/masters  { type: 'grade'|'division', value, school_id? }
router.post('/', async (req, res) => {
  const { type, value, school_id } = req.body;
  if (!['grade', 'division'].includes(type) || !value || value.trim() === '') {
    return res.status(400).json({ status: 'error', message: 'type (grade/division) and value are required' });
  }
  const table    = type === 'grade' ? 'grade_master' : 'division_master';
  const schoolId = school_id && !isNaN(school_id) ? parseInt(school_id) : null;
  try {
    await pool.query(`INSERT INTO ${table} (school_id, value, is_active) VALUES (?, ?, 1)`, [schoolId, value.trim()]);
    res.json({ status: 'success', message: `${type.charAt(0).toUpperCase() + type.slice(1)} created successfully` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/masters?type=grade|division&id=X
router.delete('/', async (req, res) => {
  const { type, id } = req.query;
  if (!['grade', 'division'].includes(type) || !id || isNaN(id)) {
    return res.status(400).json({ status: 'error', message: 'type (grade/division) and id are required' });
  }
  const table = type === 'grade' ? 'grade_master' : 'division_master';
  try {
    await pool.query(`DELETE FROM ${table} WHERE id = ?`, [parseInt(id)]);
    res.json({ status: 'success', message: `${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
