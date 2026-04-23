const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');

const LOGO_DIR = path.join(__dirname, '..', 'uploads', 'logos');
if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });

async function ensureSchoolTables(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS schools (
    id INT AUTO_INCREMENT PRIMARY KEY, school_name VARCHAR(191) NOT NULL,
    school_code VARCHAR(30) NOT NULL, address TEXT NULL, phone VARCHAR(25) NULL,
    email VARCHAR(191) NULL, logo_url VARCHAR(512) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_school_code (school_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Backfill: add logo_url to pre-existing installs that were created before this column existed
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schools' AND COLUMN_NAME='logo_url'"
  );
  if (cols.length === 0) {
    await conn.query("ALTER TABLE schools ADD COLUMN logo_url VARCHAR(512) NULL AFTER email");
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS school_admins (
    id INT AUTO_INCREMENT PRIMARY KEY, school_id INT NOT NULL,
    username VARCHAR(60) NOT NULL, password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(120) NOT NULL, email VARCHAR(191) NULL,
    role ENUM('admin','hr','security') NOT NULL DEFAULT 'admin',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_username (username), KEY idx_school (school_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

/* ── ADMINS resource ── */
router.get('/', async (req, res) => {
  const resource = req.query.resource || 'schools';
  const conn = await pool.getConnection();
  try {
    await ensureSchoolTables(conn);

    if (resource === 'admins') {
      const schoolId = req.query.school_id;
      if (!schoolId) return res.status(400).json({ error: 'school_id required' });
      const [admins] = await conn.query(
        "SELECT id, school_id, username, full_name, email, role, is_active, created_at FROM school_admins WHERE school_id=? ORDER BY created_at DESC",
        [schoolId]
      );
      return res.json({ admins });
    }

    // schools
    if (req.query.id) {
      const [rows] = await conn.query("SELECT * FROM schools WHERE id=?", [req.query.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'School not found' });
      return res.json(rows[0]);
    }
    const [schools] = await conn.query("SELECT * FROM schools ORDER BY created_at DESC");
    res.json({ schools });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/', async (req, res) => {
  const resource = req.query.resource || 'schools';
  const conn = await pool.getConnection();
  try {
    await ensureSchoolTables(conn);

    if (resource === 'admins') {
      const { school_id, username, password, full_name, email, role } = req.body;
      if (!school_id || !username || !password || !full_name) return res.status(400).json({ error: 'school_id, username, password, full_name are required' });
      const safeRole = ['admin','hr','security'].includes(role) ? role : 'admin';
      const hash = await bcrypt.hash(password, 10);
      const [result] = await conn.query(
        "INSERT INTO school_admins (school_id, username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?, ?)",
        [school_id, username, hash, full_name, email || '', safeRole]
      );
      return res.json({ success: true, id: result.insertId, message: 'Admin created successfully' });
    }

    // schools
    const { school_name, school_code, address, phone, email } = req.body;
    if (!school_name || !school_code) return res.status(400).json({ error: 'school_name and school_code are required' });
    const [result] = await conn.query(
      "INSERT INTO schools (school_name, school_code, address, phone, email) VALUES (?,?,?,?,?)",
      [school_name, school_code.toUpperCase(), address || '', phone || '', email || '']
    );
    res.json({ success: true, id: result.insertId, message: 'School created successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already exists (duplicate code or username)' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.put('/', async (req, res) => {
  const resource = req.query.resource || 'schools';
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    if (resource === 'admins') {
      const fields = []; const params = [];
      if (req.body.full_name !== undefined) { fields.push('full_name=?'); params.push(req.body.full_name.trim()); }
      if (req.body.email     !== undefined) { fields.push('email=?');     params.push(req.body.email.trim()); }
      if (req.body.role && ['admin','hr','security'].includes(req.body.role)) { fields.push('role=?'); params.push(req.body.role); }
      if (req.body.is_active !== undefined) { fields.push('is_active=?'); params.push(parseInt(req.body.is_active)); }
      if (req.body.password)  { fields.push('password_hash=?'); params.push(await bcrypt.hash(req.body.password, 10)); }
      if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
      params.push(id);
      await pool.query(`UPDATE school_admins SET ${fields.join(', ')} WHERE id=?`, params);
      return res.json({ success: true, message: 'Admin updated successfully' });
    }

    // schools
    const fields = []; const params = [];
    if (req.body.school_name !== undefined) { fields.push('school_name=?'); params.push(req.body.school_name.trim()); }
    if (req.body.address     !== undefined) { fields.push('address=?');     params.push(req.body.address); }
    if (req.body.phone       !== undefined) { fields.push('phone=?');       params.push(req.body.phone); }
    if (req.body.email       !== undefined) { fields.push('email=?');       params.push(req.body.email); }
    if (req.body.is_active   !== undefined) { fields.push('is_active=?');   params.push(parseInt(req.body.is_active)); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    await pool.query(`UPDATE schools SET ${fields.join(', ')} WHERE id=?`, params);
    res.json({ success: true, message: 'School updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── LOGO upload ── */
// POST /api/schools/logo  { school_id, filename, data_base64 }
// data_base64 may be a plain base64 string or a data URL (data:image/png;base64,...)
router.post('/logo', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureSchoolTables(conn);
    const schoolId = parseInt(req.body.school_id || 0);
    const rawData  = String(req.body.data_base64 || '');
    const rawName  = String(req.body.filename || 'logo.png');
    if (!schoolId) return res.status(400).json({ error: 'school_id required' });
    if (!rawData)  return res.status(400).json({ error: 'data_base64 required' });

    // Strip data-URL prefix if present
    const match = rawData.match(/^data:([\w\/+\-.]+);base64,(.*)$/);
    const mime  = match ? match[1] : 'image/png';
    const body  = match ? match[2] : rawData;
    const buf   = Buffer.from(body, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Invalid base64 data' });
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Logo must be under 5 MB' });

    const mimeExt = { 'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/webp':'webp','image/svg+xml':'svg','image/gif':'gif' };
    const ext = mimeExt[mime.toLowerCase()] || (path.extname(rawName).replace(/^\./,'').toLowerCase() || 'png');
    const safeExt = ['png','jpg','jpeg','webp','svg','gif'].includes(ext) ? ext : 'png';
    const fname = `school_${schoolId}_${Date.now()}.${safeExt}`;
    const fpath = path.join(LOGO_DIR, fname);
    fs.writeFileSync(fpath, buf);

    // Remove old logo file (best-effort) then update DB
    const [oldRows] = await conn.query("SELECT logo_url FROM schools WHERE id=?", [schoolId]);
    if (oldRows.length === 0) return res.status(404).json({ error: 'School not found' });
    const oldUrl = oldRows[0].logo_url;
    if (oldUrl && oldUrl.startsWith('/uploads/logos/')) {
      const oldPath = path.join(__dirname, '..', oldUrl.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (_) {} }
    }

    const logoUrl = `/uploads/logos/${fname}`;
    await conn.query("UPDATE schools SET logo_url=? WHERE id=?", [logoUrl, schoolId]);
    res.json({ success: true, logo_url: logoUrl, message: 'Logo uploaded successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.delete('/', async (req, res) => {
  const resource = req.query.resource || 'schools';
  const id = parseInt(req.body.id || req.query.id || 0);
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    if (resource === 'admins') {
      await pool.query("UPDATE school_admins SET is_active=0 WHERE id=?", [id]);
      return res.json({ success: true, message: 'Admin deactivated' });
    }
    await pool.query("UPDATE schools SET is_active=0 WHERE id=?", [id]);
    res.json({ success: true, message: 'School deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
