/**
 * parent-portal.js
 * ----------------
 * Express router that handles ALL parent-facing API endpoints used by the
 * Tap-N-Eat mobile app.
 *
 * POST /api/parent-portal?action=login        — Authenticate a parent
 * POST /api/parent-portal?action=signup       — Register a new parent account
 * POST /api/parent-portal?action=register-child — Link a new child to a parent
 * POST /api/parent-portal?action=recharge     — Direct wallet top-up (legacy)
 *
 * GET  /api/parent-portal?action=profile      — Full parent + children profile
 * GET  /api/parent-portal?action=transactions — Transaction history for a child
 * GET  /api/parent-portal?action=canteen-log  — Canteen access log for a child
 * GET  /api/parent-portal?action=subscriptions — Meal-plan subscriptions for a child
 * GET  /api/parent-portal?action=payment-history — Razorpay payment history
 * GET  /api/parent-portal?action=parents      — Admin: list all parents
 * GET  /api/parent-portal?action=children     — Admin: list children for a parent
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');

// ── Schema helpers ────────────────────────────────────────────────────────────
// These run at request time to auto-migrate older database installations that
// may be missing columns or tables added in later versions.

/**
 * Adds parent-app specific columns (parent_email, grade, division) to the
 * employees table if they do not already exist.
 */
async function ensureStudentColumns(conn) {
  const cols = {
    parent_email: 'ALTER TABLE employees ADD COLUMN parent_email VARCHAR(191) NULL AFTER emp_name',
    grade:        'ALTER TABLE employees ADD COLUMN grade VARCHAR(30) NULL AFTER shift',
    division:     'ALTER TABLE employees ADD COLUMN division VARCHAR(30) NULL AFTER grade',
  };
  for (const [col, sql] of Object.entries(cols)) {
    const [rows] = await conn.query('SHOW COLUMNS FROM employees LIKE ?', [col]);
    if (rows.length === 0) await conn.query(sql);
  }
}

/**
 * Creates the employees table with all required columns if it does not exist.
 * The "employees" table is also used to store student records in the school context.
 */
async function ensureEmployeesTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      school_id      INT NULL,
      rfid_number    VARCHAR(64) NULL UNIQUE,
      emp_id         VARCHAR(64) NULL UNIQUE,
      emp_name       VARCHAR(120) NOT NULL,
      parent_email   VARCHAR(191) NULL,
      site_name      VARCHAR(100) NULL,
      shift          VARCHAR(50)  NULL,
      grade          VARCHAR(30)  NULL,
      division       VARCHAR(30)  NULL,
      wallet_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_emp_school (school_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

/**
 * Makes the rfid_number column nullable if it was previously NOT NULL.
 * Needed so students can be registered before an RFID card is assigned.
 */
async function ensureRfidNullable(conn) {
  const [rows] = await conn.query("SHOW COLUMNS FROM employees LIKE 'rfid_number'");
  if (rows.length > 0 && rows[0].Null === 'NO') {
    await conn.query('ALTER TABLE employees MODIFY COLUMN rfid_number VARCHAR(64) NULL');
  }
}

// ── Shared response builder ───────────────────────────────────────────────────

/**
 * Builds the standard parent-profile response object.
 * Returns parent details, the linked school (name + logo), and all children
 * (students) linked to the parent's email, with their wallet balances.
 *
 * @param {object} conn   - Active DB connection
 * @param {object} parent - Row from the parents table
 * @returns {{ parent, school, children }}
 */
async function parentResponse(conn, parent) {
  const [children] = await conn.query(
    `SELECT e.id, e.school_id,
            e.emp_id         AS student_id,
            e.emp_name       AS student_name,
            e.rfid_number,
            COALESCE(NULLIF(e.grade, ''),    e.shift)     AS grade,
            COALESCE(NULLIF(e.division, ''), e.site_name) AS division,
            e.wallet_amount,
            s.school_name,
            s.logo_url AS school_logo_url
     FROM employees e
     LEFT JOIN schools s ON s.id = e.school_id
     WHERE LOWER(TRIM(e.parent_email)) = LOWER(TRIM(?))
     ORDER BY e.emp_name ASC`,
    [parent.email]
  );

  const first = children[0]; // used to determine the school linked to this parent
  return {
    parent: {
      id:        parseInt(parent.id),
      full_name: parent.full_name,
      email:     parent.email,
      phone:     parent.phone || '',
    },
    // School info comes from the first linked child (all children share one school)
    school: first
      ? { id: first.school_id, name: first.school_name, logo_url: first.school_logo_url || null }
      : null,
    children,
  };
}

// ── POST /api/parent-portal ───────────────────────────────────────────────────
// Handles: signup, login, register-child, recharge
router.post('/', async (req, res) => {
  const action = req.query.action || req.body.action || '';
  const conn   = await pool.getConnection();
  try {

    // ── Signup ─────────────────────────────────────────────────────────────
    if (action === 'signup') {
      const { full_name, email, phone, password } = req.body;

      if (!full_name || !email || !password)
        return res.status(400).json({ error: 'full_name, email and password are required' });
      if (password.length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const normEmail = email.trim().toLowerCase();
      const [existing] = await conn.query(
        'SELECT id, is_active FROM parents WHERE email=? LIMIT 1', [normEmail]
      );

      if (existing.length > 0) {
        if (parseInt(existing[0].is_active) === 1)
          return res.status(409).json({ error: 'An account with this email already exists' });

        // Account was previously deactivated — reactivate with new credentials
        const hash = await bcrypt.hash(password, 10);
        await conn.query(
          'UPDATE parents SET full_name=?, phone=?, password_hash=?, is_active=1 WHERE id=?',
          [full_name.trim(), (phone || '').trim(), hash, existing[0].id]
        );
        const reactivated = { id: existing[0].id, full_name: full_name.trim(), email: normEmail, phone: (phone || '').trim() };
        return res.json({ message: 'Account created successfully', data: await parentResponse(conn, reactivated) });
      }

      // New account
      const hash = await bcrypt.hash(password, 10);
      const [result] = await conn.query(
        'INSERT INTO parents (full_name, email, phone, password_hash, is_active) VALUES (?,?,?,?,1)',
        [full_name.trim(), normEmail, (phone || '').trim(), hash]
      );
      const newParent = { id: result.insertId, full_name: full_name.trim(), email: normEmail, phone: (phone || '').trim() };
      return res.json({ message: 'Account created successfully', data: await parentResponse(conn, newParent) });
    }

    // ── Login ──────────────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password, school_id, school_code } = req.body;

      if (!email || !password)
        return res.status(400).json({ error: 'email and password are required' });

      const [rows] = await conn.query(
        'SELECT id, full_name, email, phone, password_hash, is_active FROM parents WHERE email=? LIMIT 1',
        [email.trim().toLowerCase()]
      );
      const parent = rows[0];

      // Validate account existence and password
      if (!parent || parseInt(parent.is_active) !== 1)
        return res.status(401).json({ error: 'Invalid email or password' });
      if (!parent.password_hash || !(await bcrypt.compare(password, parent.password_hash)))
        return res.status(401).json({ error: 'Invalid email or password' });

      // Resolve school_code to school_id if the numeric id was not provided
      let resolvedSchoolId = !isNaN(parseInt(school_id)) ? parseInt(school_id) : null;
      if (!resolvedSchoolId && school_code) {
        const [schoolRows] = await conn.query(
          'SELECT id FROM schools WHERE UPPER(TRIM(school_code)) = UPPER(TRIM(?)) AND is_active = 1 LIMIT 1',
          [String(school_code).trim()]
        );
        if (schoolRows.length > 0) resolvedSchoolId = schoolRows[0].id;
      }

      // If a specific school was supplied, ensure the parent is linked to it
      if (resolvedSchoolId) {
        await ensureEmployeesTable(conn);
        await ensureStudentColumns(conn);
        const [links] = await conn.query(
          `SELECT id FROM employees
           WHERE LOWER(TRIM(parent_email)) = LOWER(TRIM(?)) AND school_id = ?
           LIMIT 1`,
          [email.trim().toLowerCase(), resolvedSchoolId]
        );
        if (links.length === 0)
          return res.status(403).json({ error: 'Parent not linked to this school' });
      }

      return res.json({ message: 'Login successful', data: await parentResponse(conn, parent) });
    }

    // ── Register Child ─────────────────────────────────────────────────────
    // Creates a new student (employee) record and links it to the parent via email.
    // RFID is intentionally left null — the school admin assigns it later.
    if (action === 'register-child') {
      const { email, student_name, student_id, grade, division, school_id, school_code } = req.body || {};

      if (!email || !student_name || !grade || !division)
        return res.status(400).json({ error: 'email, student_name, grade and division are required' });

      await ensureEmployeesTable(conn);
      await ensureStudentColumns(conn);
      await ensureRfidNullable(conn);

      const normEmail  = String(email).trim().toLowerCase();
      const [parentRows] = await conn.query(
        'SELECT id, full_name, email, phone, is_active FROM parents WHERE email=? LIMIT 1',
        [normEmail]
      );
      const parent = parentRows[0];
      if (!parent || parseInt(parent.is_active) !== 1)
        return res.status(404).json({ error: 'Parent account not found' });

      // Use the supplied student ID or generate a random one if omitted
      const safeStudentId = String(student_id || '').trim()
        || `STU${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const safeName     = String(student_name).trim();
      const safeGrade    = String(grade).trim();
      const safeDivision = String(division).trim();

      // Resolve school_code -> school_id if needed
      let schoolId = !isNaN(parseInt(school_id)) ? parseInt(school_id) : null;
      if (!schoolId && school_code) {
        const [schoolRows] = await conn.query(
          'SELECT id FROM schools WHERE UPPER(TRIM(school_code)) = UPPER(TRIM(?)) AND is_active = 1 LIMIT 1',
          [String(school_code).trim()]
        );
        if (schoolRows.length === 0)
          return res.status(400).json({ error: 'School not found. Please check the school code.' });
        schoolId = schoolRows[0].id;
      }

      const [result] = await conn.query(
        `INSERT INTO employees
           (school_id, rfid_number, emp_id, emp_name, parent_email, site_name, shift, grade, division, wallet_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [schoolId, null, safeStudentId, safeName, normEmail, safeDivision, safeGrade, safeGrade, safeDivision, 0]
      );

      return res.json({
        message: 'Child registered successfully',
        child: { id: result.insertId, student_id: safeStudentId, student_name: safeName, grade: safeGrade, division: safeDivision },
      });
    }

    // ── Direct Wallet Recharge (legacy / internal use) ─────────────────────
    // Used by internal tooling. Razorpay-verified recharges go through
    // /api/wallet-recharge-verify instead.
    if (action === 'recharge') {
      const { email, student_id, amount } = req.body;
      const amt = parseFloat(amount);

      if (!email || !student_id || !amt || amt <= 0)
        return res.status(400).json({ error: 'email, student_id and valid amount are required' });

      await conn.beginTransaction();

      // Verify parent exists and is active
      const [parentRows] = await conn.query(
        'SELECT id, full_name, email, phone, is_active FROM parents WHERE email=? LIMIT 1',
        [email.trim().toLowerCase()]
      );
      const parent = parentRows[0];
      if (!parent || parseInt(parent.is_active) !== 1) throw new Error('Parent account not found');

      // Verify the student belongs to this parent
      const [studentRows] = await conn.query(
        `SELECT id, school_id, emp_id, emp_name, rfid_number, wallet_amount
         FROM employees
         WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?))
         LIMIT 1`,
        [parseInt(student_id), email.trim().toLowerCase()]
      );
      const student = studentRows[0];
      if (!student) throw new Error('Student not found for this parent');

      // Update wallet balance
      const previousBalance = parseFloat(student.wallet_amount || 0);
      const newBalance      = previousBalance + amt;
      await conn.query('UPDATE employees SET wallet_amount=? WHERE id=?', [newBalance, parseInt(student_id)]);

      // Record the transaction in IST
      const dateObj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      await conn.query(
        `INSERT INTO transactions
           (employee_id, school_id, rfid_number, emp_id, emp_name,
            transaction_type, order_status, meal_category,
            amount, previous_balance, new_balance, transaction_time, transaction_date)
         VALUES (?, ?, ?, ?, ?, 'recharge', 'Completed', 'Wallet Recharge', ?, ?, ?, ?, ?)`,
        [
          parseInt(student_id), student.school_id ? parseInt(student.school_id) : null,
          student.rfid_number, student.emp_id, student.emp_name,
          amt, previousBalance, newBalance,
          dateObj.toTimeString().split(' ')[0],
          dateObj.toISOString().split('T')[0],
        ]
      );
      await conn.commit();

      const [freshParent] = await conn.query(
        'SELECT id, full_name, email, phone FROM parents WHERE id=? LIMIT 1',
        [parseInt(parent.id)]
      );
      return res.json({
        message: 'Wallet recharged successfully',
        student: { id: parseInt(student_id), student_name: student.emp_name, student_id: student.emp_id, wallet_amount: newBalance },
        data: await parentResponse(conn, freshParent[0]),
      });
    }

    res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    await conn.rollback().catch(() => {});
    // Surface friendly duplicate-entry messages
    if (err.code === 'ER_DUP_ENTRY') {
      const msg = err.message.includes('emp_id')      ? 'Admission ID already exists'
                : err.message.includes('rfid_number') ? 'RFID already exists'
                : 'Duplicate entry';
      return res.status(400).json({ error: msg });
    }
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── GET /api/parent-portal ────────────────────────────────────────────────────
// Read-only queries: profile, transactions, canteen log, subscriptions, etc.
router.get('/', async (req, res) => {
  const action = req.query.action || '';
  const conn   = await pool.getConnection();
  try {

    // ── Admin: list all parents (optionally filtered by school) ────────────
    if (action === 'parents' || action === 'parents-list' || action === 'parent-list') {
      const schoolId = req.query.school_id && !isNaN(req.query.school_id)
        ? parseInt(req.query.school_id) : null;

      let sql = `
        SELECT p.id, p.full_name, p.email, p.phone, p.is_active, p.created_at,
               COUNT(e.id) AS children_count
        FROM parents p
        LEFT JOIN employees e ON LOWER(TRIM(e.parent_email)) = LOWER(TRIM(p.email))
      `;
      const params = [];
      const where  = ['p.is_active = 1'];
      if (schoolId) { where.push('e.school_id = ?'); params.push(schoolId); }
      sql += ` WHERE ${where.join(' AND ')} GROUP BY p.id ORDER BY p.created_at DESC`;

      const [rows] = await conn.query(sql, params);
      return res.json({ parents: rows });
    }

    // ── Admin: list children for a given parent ────────────────────────────
    if (action === 'children' || action === 'children-list') {
      const parentId = req.query.parent_id && !isNaN(req.query.parent_id)
        ? parseInt(req.query.parent_id) : null;
      let email = (req.query.email || '').trim().toLowerCase();

      // Resolve parent_id → email if email not directly provided
      if (!email && parentId) {
        const [rows] = await conn.query(
          'SELECT id, full_name, email, phone, is_active FROM parents WHERE id=? LIMIT 1',
          [parentId]
        );
        const p = rows[0];
        if (!p || parseInt(p.is_active) !== 1)
          return res.status(404).json({ error: 'Parent not found' });
        email = p.email;
      }
      if (!email) return res.status(400).json({ error: 'email or parent_id is required' });

      const [rows] = await conn.query(
        'SELECT id, full_name, email, phone, is_active FROM parents WHERE email=? LIMIT 1',
        [email]
      );
      const parent = rows[0];
      if (!parent || parseInt(parent.is_active) !== 1)
        return res.status(404).json({ error: 'Parent not found' });
      return res.json(await parentResponse(conn, parent));
    }

    // ── Parent profile (used by the mobile app on every dashboard load) ────
    if (action === 'profile') {
      const email = (req.query.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'email is required' });

      const [rows] = await conn.query(
        'SELECT id, full_name, email, phone, is_active FROM parents WHERE email=? LIMIT 1',
        [email]
      );
      const parent = rows[0];
      if (!parent || parseInt(parent.is_active) !== 1)
        return res.status(404).json({ error: 'Parent not found' });
      return res.json(await parentResponse(conn, parent));
    }

    // ── Meal-plan subscriptions for a specific child ───────────────────────
    if (action === 'subscriptions') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      if (!email || !studentId)
        return res.status(400).json({ error: 'email and student_id are required' });

      // Confirm the student belongs to this parent
      const [ownership] = await conn.query(
        'SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1',
        [studentId, email]
      );
      if (ownership.length === 0)
        return res.status(404).json({ error: 'Student not found for this parent' });

      const [subscriptions] = await conn.query(
        `SELECT id, meal_type_id, meal_type_name, month, year, grade, amount_paid, status, subscribed_at
         FROM meal_subscriptions
         WHERE student_id = ?
         ORDER BY year DESC, month DESC, meal_type_name ASC`,
        [studentId]
      ).catch(() => [[]]); // table may not exist on older installs

      return res.json({ student: ownership[0], subscriptions });
    }

    // ── Canteen access log for a specific child ────────────────────────────
    // Records every RFID tap at the canteen gate (granted or denied).
    if (action === 'canteen-log') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit || 30)));
      if (!email || !studentId)
        return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        'SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1',
        [studentId, email]
      );
      if (ownership.length === 0)
        return res.status(404).json({ error: 'Student not found for this parent' });

      const [log] = await conn.query(
        `SELECT id, meal_type_name, access_status, deny_reason, access_date, access_time, created_at
         FROM canteen_access_log
         WHERE student_id = ?
         ORDER BY access_date DESC, access_time DESC
         LIMIT ?`,
        [studentId, limit]
      ).catch(() => [[]]); // table may not exist on older installs

      return res.json({ student: ownership[0], canteen_log: log });
    }

    // ── Wallet transaction history for a specific child ────────────────────
    // Includes both debit (meal purchases) and credit (wallet recharges).
    if (action === 'transactions') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      const limit     = Math.min(200, Math.max(1, parseInt(req.query.limit || 50)));
      if (!email || !studentId)
        return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        'SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1',
        [studentId, email]
      );
      if (ownership.length === 0)
        return res.status(404).json({ error: 'Student not found for this parent' });

      const [transactions] = await conn.query(
        `SELECT id, transaction_type, order_status, meal_category, amount,
                previous_balance, new_balance, transaction_date, transaction_time, created_at
         FROM transactions
         WHERE employee_id = ?
         ORDER BY transaction_date DESC, transaction_time DESC, created_at DESC
         LIMIT ?`,
        [studentId, limit]
      );
      return res.json({ student: ownership[0], transactions });
    }

    // ── Razorpay payment history for a specific child ──────────────────────
    // Shows records from wallet_recharge_payments (created by wallet-recharge-verify).
    if (action === 'payment-history') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit || 50)));
      if (!email || !studentId)
        return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        'SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1',
        [studentId, email]
      );
      if (ownership.length === 0)
        return res.status(404).json({ error: 'Student not found for this parent' });

      const [payments] = await conn.query(
        `SELECT id, razorpay_order_id, razorpay_payment_id, meal_type_name, payment_for,
                payment_months, payment_year, sub_total, convenience_fee, total_paid,
                payment_status, created_at
         FROM wallet_recharge_payments
         WHERE student_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [studentId, limit]
      ).catch(() => [[]]); // table may not exist on older installs

      return res.json({ student: ownership[0], payments });
    }

    // Unknown action
    res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
