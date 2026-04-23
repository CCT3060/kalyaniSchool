const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const bcrypt  = require('bcryptjs');

// POST /api/school-auth  { username, password }
router.post('/', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  const { buildPermMap, ALL_SECTIONS, DEFAULT_PERM } = require('./permissions');

  try {
    const [rows] = await pool.query(
      `SELECT sa.id, sa.school_id, sa.username, sa.password_hash, sa.full_name, sa.role,
              s.school_name, s.logo_url AS school_logo_url
       FROM school_admins sa
       JOIN schools s ON sa.school_id=s.id
       WHERE sa.username=? AND sa.is_active=1 AND s.is_active=1
       LIMIT 1`,
      [username.trim()]
    );

    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const admin = rows[0];

    // Fetch permissions (table may not exist yet on first login)
    let permissions = {};
    try {
      const [permRows] = await pool.query(
        'SELECT * FROM admin_permissions WHERE admin_id=?', [admin.id]
      );
      permissions = buildPermMap(permRows);
    } catch (_) {
      // If table doesn't exist yet, return full default permissions
      const defaults = {};
      for (const s of ALL_SECTIONS) defaults[s] = { ...DEFAULT_PERM };
      permissions = defaults;
    }

    res.json({
      success: true,
      admin_id:        parseInt(admin.id),
      school_id:       parseInt(admin.school_id),
      school_name:     admin.school_name,
      school_logo_url: admin.school_logo_url || null,
      full_name:       admin.full_name,
      role:            admin.role,
      permissions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
