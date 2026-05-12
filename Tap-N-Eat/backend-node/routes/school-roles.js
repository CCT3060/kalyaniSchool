const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS school_roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    school_id INT NOT NULL,
    role_name VARCHAR(80) NOT NULL,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_school_role (school_id, role_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// GET /api/school-roles?school_id=X
router.get('/', async (req, res) => {
  const schoolId = parseInt(req.query.school_id || 0);
  if (!schoolId) return res.status(400).json({ error: 'school_id is required' });
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const [roles] = await conn.query(
      'SELECT id, school_id, role_name, description, is_active FROM school_roles WHERE school_id=? ORDER BY role_name ASC',
      [schoolId]
    );
    res.json({ roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/school-roles  { school_id, role_name, description }
router.post('/', async (req, res) => {
  const { school_id, role_name, description } = req.body;
  if (!school_id || !role_name || !role_name.trim())
    return res.status(400).json({ error: 'school_id and role_name are required' });
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const [result] = await conn.query(
      'INSERT INTO school_roles (school_id, role_name, description, is_active) VALUES (?,?,?,1)',
      [parseInt(school_id), role_name.trim(), (description || '').trim() || null]
    );
    res.json({ message: 'Role created', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A role with this name already exists for this school' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/school-roles  { id, role_name, description }
router.put('/', async (req, res) => {
  const { id, role_name, description } = req.body;
  if (!id || !role_name || !role_name.trim())
    return res.status(400).json({ error: 'id and role_name are required' });
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    await conn.query(
      'UPDATE school_roles SET role_name=?, description=? WHERE id=?',
      [role_name.trim(), (description || '').trim() || null, parseInt(id)]
    );
    res.json({ message: 'Role updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A role with this name already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/school-roles?id=X
router.delete('/', async (req, res) => {
  const id = parseInt(req.query.id || 0);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    await conn.query('DELETE FROM school_roles WHERE id=?', [id]);
    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
