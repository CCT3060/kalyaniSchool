const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS monthly_meal_plans (
    id INT AUTO_INCREMENT PRIMARY KEY, school_id INT NULL, meal_type_id INT NOT NULL,
    month TINYINT NOT NULL, year SMALLINT NOT NULL, grade VARCHAR(30) NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00, is_active TINYINT(1) NOT NULL DEFAULT 1,
    category_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_monthly_plan (school_id, meal_type_id, month, year, grade)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Add grade column if missing
  const [cols] = await conn.query("SHOW COLUMNS FROM monthly_meal_plans LIKE 'grade'").catch(() => [[]]);
  if (cols.length === 0) {
    await conn.query("ALTER TABLE monthly_meal_plans ADD COLUMN grade VARCHAR(30) NULL AFTER year").catch(() => {});
    await conn.query("ALTER TABLE monthly_meal_plans DROP INDEX uq_monthly_plan").catch(() => {});
    await conn.query("ALTER TABLE monthly_meal_plans ADD UNIQUE KEY uq_monthly_plan (school_id, meal_type_id, month, year, grade)").catch(() => {});
  }
  // Migrate start_time/end_time → category_id
  const [catCol] = await conn.query("SHOW COLUMNS FROM monthly_meal_plans LIKE 'category_id'").catch(() => [[]]);
  if (catCol.length === 0) {
    await conn.query("ALTER TABLE monthly_meal_plans ADD COLUMN category_id INT NULL AFTER price").catch(() => {});
  }
  // Remove old timing columns if they exist (safe no-op if already gone)
  await conn.query("ALTER TABLE monthly_meal_plans DROP COLUMN start_time").catch(() => {});
  await conn.query("ALTER TABLE monthly_meal_plans DROP COLUMN end_time").catch(() => {});
}

// Look up meal type by name, creating it if it doesn't exist
async function findOrCreateMealType(conn, name) {
  if (!name) return 0;
  const trimmed = name.trim();
  const [rows] = await conn.query('SELECT id FROM meal_type_master WHERE meal_name=? LIMIT 1', [trimmed]);
  if (rows.length > 0) return rows[0].id;
  const [result] = await conn.query('INSERT INTO meal_type_master (meal_name, is_active) VALUES (?, 1)', [trimmed]);
  return result.insertId;
}

// GET /api/monthly-meal-plans[?school_id=X&year=Y&meal_type_id=Z&grade=G]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const schoolId   = req.query.school_id   && !isNaN(req.query.school_id)   ? parseInt(req.query.school_id)   : null;
    const year       = req.query.year        && !isNaN(req.query.year)        ? parseInt(req.query.year)        : new Date().getFullYear();
    const yearEnd    = req.query.year_end    && !isNaN(req.query.year_end)    ? parseInt(req.query.year_end)    : null;
    const mealTypeId = req.query.meal_type_id && !isNaN(req.query.meal_type_id) ? parseInt(req.query.meal_type_id) : null;
    const grade      = req.query.grade ? req.query.grade.trim() : null;
    const month      = req.query.month && !isNaN(req.query.month) ? parseInt(req.query.month) : null;
    const showAll    = req.query.show_all === '1'; // admin flag: include inactive plans

    let sql = `SELECT mmp.id, mmp.school_id, mmp.meal_type_id, mmp.month, mmp.year,
                      mmp.grade, mmp.price, mmp.category_id, mmp.is_active,
                      mt.meal_name,
                      mc.category_name, mc.start_time, mc.end_time
               FROM monthly_meal_plans mmp
               JOIN meal_type_master mt ON mt.id = mmp.meal_type_id
               LEFT JOIN meal_categories mc ON mc.id = mmp.category_id AND mc.is_active = 1
               WHERE ${yearEnd ? 'mmp.year BETWEEN ? AND ?' : 'mmp.year=?'}${showAll ? '' : ' AND mmp.is_active=1'}`;
    const params = yearEnd ? [year, yearEnd] : [year];
    if (schoolId)   { sql += ' AND (mmp.school_id=? OR mmp.school_id IS NULL)'; params.push(schoolId); }
    if (mealTypeId) { sql += ' AND mmp.meal_type_id=?'; params.push(mealTypeId); }
    if (month)      { sql += ' AND mmp.month=?'; params.push(month); }
    if (grade) {
      sql += ' AND (mmp.grade=? OR mmp.grade IS NULL)';
      params.push(grade);
    }
    sql += ' ORDER BY mmp.year ASC, mmp.month ASC, mmp.grade IS NULL ASC, mmp.grade ASC, mt.meal_name ASC';

    const [plans] = await conn.query(sql, params);

    if (grade && plans.length > 0) {
      const best = {};
      for (const p of plans) {
        const key = `${p.meal_type_id}_${p.month}`;
        if (!best[key] || p.grade !== null) best[key] = p;
      }
      return res.json({ plans: Object.values(best) });
    }

    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/monthly-meal-plans
// Single: { school_id, meal_type_id, month, year, price, grade, category_id }
// Bulk:   { bulk: [ { meal_type_id, month, year, price, grade, category_id }, ... ], school_id }
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const schoolId = req.body.school_id ? parseInt(req.body.school_id) : null;

    // ── Bulk import ───────────────────────────────────────────────────────────
    if (Array.isArray(req.body.bulk)) {
      const rows   = req.body.bulk;
      const errors = [];
      let   saved  = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let mealTypeId = parseInt(r.meal_type_id || 0);
        if (!mealTypeId && r.meal_type_name) mealTypeId = await findOrCreateMealType(conn, r.meal_type_name);
        const month      = parseInt(r.month || 0);
        const year       = parseInt(r.year  || new Date().getFullYear());
        const price      = r.price !== undefined ? parseFloat(r.price) : -1;
        const grade      = r.grade ? String(r.grade).trim() : null;
        const categoryId = r.category_id ? parseInt(r.category_id) : null;

        if (mealTypeId <= 0 || month < 1 || month > 12 || price < 0) {
          errors.push(`Row ${i + 1}: meal_type_id, month (1-12), price (>=0) required`);
          continue;
        }

        await conn.query(
          `INSERT INTO monthly_meal_plans (school_id, meal_type_id, month, year, grade, price, category_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE price=VALUES(price), category_id=VALUES(category_id), is_active=1, updated_at=NOW()`,
          [schoolId, mealTypeId, month, year, grade, price, categoryId]
        ).catch((e) => errors.push(`Row ${i + 1}: ${e.message}`));

        saved++;
      }

      return res.json({ message: `${saved} plan(s) saved`, errors: errors.length ? errors : undefined });
    }

    // ── Single save ───────────────────────────────────────────────────────────
    let mealTypeId = parseInt(req.body.meal_type_id || 0);
    if (!mealTypeId && req.body.meal_type_name) mealTypeId = await findOrCreateMealType(conn, req.body.meal_type_name);
    const month      = parseInt(req.body.month || 0);
    const year       = parseInt(req.body.year  || new Date().getFullYear());
    const price      = req.body.price !== undefined ? parseFloat(req.body.price) : -1;
    const grade      = req.body.grade ? req.body.grade.trim() : null;
    const categoryId = req.body.category_id ? parseInt(req.body.category_id) : null;

    if (mealTypeId <= 0 || month < 1 || month > 12 || price < 0) {
      return res.status(400).json({ error: 'meal_type_id, month (1-12), and price (>=0) are required' });
    }

    const [result] = await conn.query(
      `INSERT INTO monthly_meal_plans (school_id, meal_type_id, month, year, grade, price, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price=VALUES(price), category_id=VALUES(category_id), is_active=1, updated_at=NOW()`,
      [schoolId, mealTypeId, month, year, grade, price, categoryId]
    );
    res.json({ message: 'Monthly meal plan saved', id: result.insertId || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/monthly-meal-plans?id=X  { price, grade, category_id, meal_type_name, month, year }
router.put('/', async (req, res) => {
  const id = parseInt(req.query.id || 0);
  if (!id) return res.status(400).json({ error: 'id is required' });
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const fields = [];
    const params = [];
    if (req.body.price !== undefined)       { fields.push('price=?');       params.push(parseFloat(req.body.price)); }
    if (req.body.grade !== undefined)       { fields.push('grade=?');       params.push(req.body.grade ? String(req.body.grade).trim() : null); }
    if (req.body.category_id !== undefined) { fields.push('category_id=?'); params.push(req.body.category_id ? parseInt(req.body.category_id) : null); }
    if (req.body.month !== undefined)       { fields.push('month=?');       params.push(parseInt(req.body.month)); }
    if (req.body.year !== undefined)        { fields.push('year=?');        params.push(parseInt(req.body.year)); }
    if (req.body.meal_type_name !== undefined && req.body.meal_type_name.trim()) {
      const mealTypeId = await findOrCreateMealType(conn, req.body.meal_type_name.trim());
      fields.push('meal_type_id=?');
      params.push(mealTypeId);
    }
    if (req.body.is_active !== undefined) { fields.push('is_active=?'); params.push(parseInt(req.body.is_active) ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push('updated_at=NOW()');
    params.push(id);
    await conn.query(`UPDATE monthly_meal_plans SET ${fields.join(', ')} WHERE id=?`, params);
    res.json({ message: 'Monthly meal plan updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/monthly-meal-plans?id=X
router.delete('/', async (req, res) => {
  const id = parseInt(req.query.id || 0);
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    await pool.query('DELETE FROM monthly_meal_plans WHERE id=?', [id]);
    res.json({ message: 'Monthly meal plan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
