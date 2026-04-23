const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');

async function ensureStudentColumns(conn) {
  const cols = {
    parent_email: "ALTER TABLE employees ADD COLUMN parent_email VARCHAR(191) NULL AFTER emp_name",
    grade:        "ALTER TABLE employees ADD COLUMN grade VARCHAR(30) NULL AFTER shift",
    division:     "ALTER TABLE employees ADD COLUMN division VARCHAR(30) NULL AFTER grade",
  };
  for (const [col, sql] of Object.entries(cols)) {
    const [rows] = await conn.query('SHOW COLUMNS FROM employees LIKE ?', [col]);
    if (rows.length === 0) await conn.query(sql);
  }
}

async function ensureParentStudentTables(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS parents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    phone VARCHAR(25) NULL,
    password_hash VARCHAR(255) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);

  await conn.query(`CREATE TABLE IF NOT EXISTS students (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    admission_no VARCHAR(64) NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    rfid_uid VARCHAR(64) NOT NULL UNIQUE,
    parent_id BIGINT UNSIGNED NOT NULL,
    grade VARCHAR(30) NULL,
    section_name VARCHAR(30) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_students_parent_api FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE RESTRICT,
    INDEX idx_students_parent (parent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
}

async function ensureEmployeesTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    school_id INT NULL,
    rfid_number VARCHAR(64) NOT NULL UNIQUE,
    emp_id VARCHAR(64) NULL UNIQUE,
    emp_name VARCHAR(120) NOT NULL,
    parent_email VARCHAR(191) NULL,
    site_name VARCHAR(100) NULL,
    shift VARCHAR(50) NULL,
    grade VARCHAR(30) NULL,
    division VARCHAR(30) NULL,
    wallet_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_emp_school (school_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
}

async function ensureSchoolIdOnEmployees(conn) {
  await ensureEmployeesTable(conn);
  const [rows] = await conn.query("SHOW COLUMNS FROM employees LIKE 'school_id'");
  if (rows.length === 0) {
    await conn.query("ALTER TABLE employees ADD COLUMN school_id INT NULL AFTER id");
    await conn.query("ALTER TABLE employees ADD KEY idx_emp_school (school_id)");
  }
}

async function resolveParentId(conn, parentEmail, parentName, parentPassword) {
  const safeName = parentName.trim() !== '' ? parentName.trim() : 'Parent';
  const [existing] = await conn.query('SELECT id FROM parents WHERE email = ? LIMIT 1', [parentEmail]);
  if (existing.length > 0) {
    const id = existing[0].id;
    if (safeName) await conn.query('UPDATE parents SET full_name = ? WHERE id = ?', [safeName, id]);
    if (parentPassword && parentPassword.trim() !== '') {
      const hashed = await bcrypt.hash(parentPassword.trim(), 10);
      await conn.query('UPDATE parents SET password_hash = ? WHERE id = ?', [hashed, id]);
    }
    return Number(id);
  }

  let hash = null;
  if (parentPassword && parentPassword.trim() !== '') {
    hash = await bcrypt.hash(parentPassword.trim(), 10);
  }
  const [result] = await conn.query(
    'INSERT INTO parents (full_name, email, password_hash) VALUES (?, ?, ?)',
    [safeName, parentEmail, hash]
  );
  return result.insertId;
}

async function syncStudentRecord(conn, payload, parentId) {
  await conn.query(
    `INSERT INTO students (admission_no, full_name, rfid_uid, parent_id, grade, section_name, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       admission_no = VALUES(admission_no), full_name = VALUES(full_name),
       parent_id = VALUES(parent_id), grade = VALUES(grade),
       section_name = VALUES(section_name), is_active = 1`,
    [payload.student_id, payload.student_name, payload.rfid_number, parentId, payload.grade, payload.division]
  );
}

function normalizePayload(data) {
  const rfid        = (data.rfid_number ?? '').toString().trim();
  const studentName = (data.student_name ?? data.full_name ?? data.emp_name ?? '').toString().trim();
  const rawId       = (data.student_id ?? data.admission_no ?? data.emp_id ?? '').toString().trim();
  const studentId   = rawId || ('STU' + crypto.randomBytes(3).toString('hex').toUpperCase());
  const parentEmail = (data.parent_email ?? '').toString().trim().toLowerCase();
  const parentName  = (data.parent_name ?? '').toString().trim();
  const grade       = (data.grade ?? data.standard ?? data.shift ?? '').toString().trim();
  const division    = (data.division ?? data.section ?? data.site_name ?? '').toString().trim();
  const walletAmount = parseFloat(data.wallet_amount ?? 0);
  const parentPassword = (data.parent_password ?? '').toString().trim();
  return { rfid_number: rfid, student_name: studentName, student_id: studentId, parent_email: parentEmail, parent_name: parentName, grade, division, wallet_amount: walletAmount, parent_password: parentPassword };
}

// GET /api/employees  or  GET /api/employees?id=X  [?school_id=Y]
router.get('/', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    await ensureStudentColumns(conn);
    await ensureParentStudentTables(conn);
    await ensureSchoolIdOnEmployees(conn);

    const schoolId = req.query.school_id && !isNaN(req.query.school_id) ? parseInt(req.query.school_id) : null;

    if (req.query.id) {
      let q = `SELECT e.*, p.full_name AS parent_name,
                 e.emp_name AS student_name, e.emp_id AS student_id,
                 COALESCE(NULLIF(e.grade,''), e.shift) AS grade,
                 COALESCE(NULLIF(e.division,''), e.site_name) AS division
               FROM employees e
               LEFT JOIN parents p ON LOWER(TRIM(p.email)) COLLATE utf8mb4_general_ci = LOWER(TRIM(e.parent_email)) COLLATE utf8mb4_general_ci
               WHERE e.id = ?`;
      const params = [req.query.id];
      if (schoolId) { q += ' AND e.school_id = ?'; params.push(schoolId); }
      const [rows] = await conn.query(q, params);
      conn.release();
      if (rows.length === 0) return res.status(404).json({ message: 'Student not found' });
      return res.json(rows[0]);
    }

    let q = `SELECT e.*, p.full_name AS parent_name,
               e.emp_name AS student_name, e.emp_id AS student_id,
               COALESCE(NULLIF(e.grade,''), e.shift) AS grade,
               COALESCE(NULLIF(e.division,''), e.site_name) AS division
             FROM employees e
             LEFT JOIN parents p ON LOWER(TRIM(p.email)) COLLATE utf8mb4_general_ci = LOWER(TRIM(e.parent_email)) COLLATE utf8mb4_general_ci`;
    const params = [];
    if (schoolId) { q += ' WHERE e.school_id = ?'; params.push(schoolId); }
    q += ' ORDER BY e.created_at DESC';
    const [rows] = await conn.query(q, params);
    conn.release();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/employees
router.post('/', async (req, res) => {
  const payload = normalizePayload(req.body);
  if (!payload.rfid_number || !payload.student_name || !payload.parent_email || !payload.grade || !payload.division) {
    return res.status(400).json({ message: 'Required fields: Full Name, RFID Card ID, Parent Email ID, Grade/Standard, Division' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureStudentColumns(conn);
    await ensureParentStudentTables(conn);
    await ensureSchoolIdOnEmployees(conn);

    const parentId = await resolveParentId(conn, payload.parent_email, payload.parent_name, payload.parent_password);
    await syncStudentRecord(conn, payload, parentId);

    const schoolId = req.body.school_id && !isNaN(req.body.school_id) ? parseInt(req.body.school_id) : null;
    const [result] = await conn.query(
      `INSERT INTO employees (school_id, rfid_number, emp_id, emp_name, parent_email, site_name, shift, grade, division, wallet_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, payload.rfid_number, payload.student_id, payload.student_name, payload.parent_email,
       payload.division, payload.grade, payload.grade, payload.division, payload.wallet_amount]
    );
    await conn.commit();
    res.status(201).json({ message: 'Student registered successfully', id: result.insertId, student_id: payload.student_id, parent_id: parentId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const msg = err.message.includes('rfid_number') ? 'RFID Card ID already exists'
                : err.message.includes('emp_id')      ? 'Student ID already exists'
                : err.message.includes('email')       ? 'Parent email already exists with another account'
                : 'Duplicate entry';
      return res.status(400).json({ message: msg });
    }
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/employees
router.put('/', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ message: 'Missing student ID' });
  const payload = normalizePayload(req.body);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (payload.parent_email) {
      const parentId = await resolveParentId(conn, payload.parent_email, payload.parent_name, payload.parent_password);
      await syncStudentRecord(conn, payload, parentId);
    }
    await conn.query(
      `UPDATE employees SET rfid_number=?, emp_id=?, emp_name=?, parent_email=?,
       site_name=?, shift=?, grade=?, division=?, wallet_amount=? WHERE id=?`,
      [payload.rfid_number, payload.student_id, payload.student_name, payload.parent_email,
       payload.division, payload.grade, payload.grade, payload.division, payload.wallet_amount, id]
    );
    await conn.commit();
    res.json({ message: 'Student updated successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ message: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/employees
router.delete('/', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ message: 'Missing student ID' });
  try {
    await pool.query('DELETE FROM employees WHERE id = ?', [id]);
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
