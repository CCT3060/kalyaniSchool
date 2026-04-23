const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// All configurable sections in the admin dashboard
const ALL_SECTIONS = [
  'students',
  'masters',
  'meal-categories',
  'monthly-plans',
  'meal-subscriptions',
  'reports',
  'tuckshop',
  'rfid-scan',
  'wallet',
  'transactions',
];

const DEFAULT_PERM = {
  can_view: 1, can_create: 1, can_edit: 1,
  can_delete: 1, can_import: 1, can_export: 1,
};

async function ensurePermissionsTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS admin_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    section VARCHAR(60) NOT NULL,
    can_view   TINYINT(1) NOT NULL DEFAULT 1,
    can_create TINYINT(1) NOT NULL DEFAULT 1,
    can_edit   TINYINT(1) NOT NULL DEFAULT 1,
    can_delete TINYINT(1) NOT NULL DEFAULT 1,
    can_import TINYINT(1) NOT NULL DEFAULT 1,
    can_export TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_admin_section (admin_id, section)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function buildPermMap(rows) {
  const perms = {};
  for (const section of ALL_SECTIONS) {
    const row = rows.find((r) => r.section === section);
    perms[section] = row
      ? {
          can_view:   row.can_view   ? 1 : 0,
          can_create: row.can_create ? 1 : 0,
          can_edit:   row.can_edit   ? 1 : 0,
          can_delete: row.can_delete ? 1 : 0,
          can_import: row.can_import ? 1 : 0,
          can_export: row.can_export ? 1 : 0,
        }
      : { ...DEFAULT_PERM };
  }
  return perms;
}

// GET /api/permissions?admin_id=X
router.get('/', async (req, res) => {
  const adminId = parseInt(req.query.admin_id);
  if (!adminId) return res.status(400).json({ error: 'admin_id required' });

  const conn = await pool.getConnection();
  try {
    await ensurePermissionsTable(conn);
    const [rows] = await conn.query(
      'SELECT * FROM admin_permissions WHERE admin_id=?',
      [adminId]
    );
    res.json({ permissions: buildPermMap(rows), sections: ALL_SECTIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/permissions
// body: { admin_id: Number, sections: [{ section, can_view, can_create, can_edit, can_delete, can_import, can_export }] }
router.post('/', async (req, res) => {
  const adminId = parseInt(req.body.admin_id);
  const sections = req.body.sections;
  if (!adminId || !Array.isArray(sections)) {
    return res.status(400).json({ error: 'admin_id and sections[] are required' });
  }

  const conn = await pool.getConnection();
  try {
    await ensurePermissionsTable(conn);
    for (const s of sections) {
      if (!ALL_SECTIONS.includes(s.section)) continue;
      await conn.query(
        `INSERT INTO admin_permissions
           (admin_id, section, can_view, can_create, can_edit, can_delete, can_import, can_export)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           can_view=VALUES(can_view), can_create=VALUES(can_create), can_edit=VALUES(can_edit),
           can_delete=VALUES(can_delete), can_import=VALUES(can_import), can_export=VALUES(can_export)`,
        [
          adminId, s.section,
          s.can_view   ? 1 : 0,
          s.can_create ? 1 : 0,
          s.can_edit   ? 1 : 0,
          s.can_delete ? 1 : 0,
          s.can_import ? 1 : 0,
          s.can_export ? 1 : 0,
        ]
      );
    }
    const [newRows] = await conn.query(
      'SELECT * FROM admin_permissions WHERE admin_id=?', [adminId]
    );
    res.json({ message: 'Permissions saved successfully', permissions: buildPermMap(newRows) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
module.exports.ALL_SECTIONS  = ALL_SECTIONS;
module.exports.DEFAULT_PERM  = DEFAULT_PERM;
module.exports.buildPermMap  = buildPermMap;
