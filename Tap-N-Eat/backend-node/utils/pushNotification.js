/**
 * pushNotification.js
 * -------------------
 * Backend helper for Expo Push Notifications.
 *
 * Exported functions:
 *  - ensurePushTokensTable(conn)          — auto-creates the DB table
 *  - getTokensByEmail(parentEmail)        — returns active tokens for a parent
 *  - getTokensByStudentId(studentId)      — returns tokens via student→parent lookup
 *  - sendPushNotifications(tokens, ...)   — sends notifications via Expo Push API
 *  - sendNotificationToParentByEmail(...)     — convenience: lookup + send
 *  - sendNotificationToParentByStudentId(...) — convenience: lookup + send
 */

const https = require('https');
const pool  = require('../config/database');

// ── Table management ──────────────────────────────────────────────────────────

/**
 * Creates the parent_push_tokens table if it does not exist.
 * Also called by the push-tokens route, so it is safe to call multiple times.
 *
 * @param {import('mysql2').Connection} conn
 */
async function ensurePushTokensTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS parent_push_tokens (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      parent_email VARCHAR(191) NOT NULL,
      push_token   VARCHAR(255) NOT NULL,
      is_active    TINYINT(1)  NOT NULL DEFAULT 1,
      created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_parent_token (parent_email, push_token),
      INDEX idx_parent_email (parent_email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── Token retrieval ───────────────────────────────────────────────────────────

/**
 * Returns all active Expo Push Tokens registered for a parent email.
 *
 * @param {string} parentEmail
 * @returns {Promise<string[]>}
 */
async function getTokensByEmail(parentEmail) {
  if (!parentEmail) return [];
  const conn = await pool.getConnection();
  try {
    await ensurePushTokensTable(conn);
    const [rows] = await conn.query(
      'SELECT push_token FROM parent_push_tokens WHERE LOWER(TRIM(parent_email)) = ? AND is_active = 1',
      [parentEmail.trim().toLowerCase()]
    );
    return rows.map((r) => r.push_token);
  } catch {
    return [];
  } finally {
    conn.release();
  }
}

/**
 * Returns all active Expo Push Tokens for the parent of a given student.
 * Looks up parent_email from the employees table using the student ID.
 *
 * @param {number|string} studentId - The employee/student ID
 * @returns {Promise<string[]>}
 */
async function getTokensByStudentId(studentId) {
  if (!studentId) return [];
  const conn = await pool.getConnection();
  try {
    await ensurePushTokensTable(conn);
    const [empRows] = await conn.query(
      'SELECT parent_email FROM employees WHERE id = ? LIMIT 1',
      [studentId]
    );
    if (empRows.length === 0 || !empRows[0].parent_email) return [];

    const parentEmail = empRows[0].parent_email.trim().toLowerCase();
    const [rows] = await conn.query(
      'SELECT push_token FROM parent_push_tokens WHERE LOWER(TRIM(parent_email)) = ? AND is_active = 1',
      [parentEmail]
    );
    return rows.map((r) => r.push_token);
  } catch {
    return [];
  } finally {
    conn.release();
  }
}

// ── Token lifecycle ───────────────────────────────────────────────────────────

/**
 * Marks a push token as inactive.
 * Called when Expo reports DeviceNotRegistered for a token.
 *
 * @param {string} pushToken
 */
async function deactivateToken(pushToken) {
  try {
    await pool.query(
      'UPDATE parent_push_tokens SET is_active = 0 WHERE push_token = ?',
      [pushToken]
    );
  } catch {
    // Non-fatal; ignore
  }
}

// ── Sending ───────────────────────────────────────────────────────────────────

/**
 * Sends Expo push notifications to one or more tokens via the Expo Push API.
 * Invalid tokens (DeviceNotRegistered) are automatically deactivated.
 *
 * @param {string[]} tokens - Array of Expo Push Token strings
 * @param {string}   title  - Notification title
 * @param {string}   body   - Notification body
 * @param {Object}   data   - Data payload for navigation on tap
 * @returns {Promise<void>}
 */
async function sendPushNotifications(tokens, title, body, data = {}) {
  if (!tokens || tokens.length === 0) return;

  // Only send to valid Expo push token format
  const validTokens = tokens.filter(
    (t) => t && /^Expo(nent)?PushToken\[.+\]$/.test(t)
  );
  if (validTokens.length === 0) return;

  const messages = validTokens.map((token) => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'default',
  }));

  return new Promise((resolve) => {
    const payload = JSON.stringify(messages);
    const options = {
      hostname: 'exp.host',
      path: '/--/api/v2/push/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', async () => {
        try {
          const result = JSON.parse(raw);
          const tickets = result.data || [];
          // Deactivate tokens that Expo reports as no longer registered
          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            if (
              ticket.status === 'error' &&
              ticket.details?.error === 'DeviceNotRegistered'
            ) {
              await deactivateToken(validTokens[i]).catch(() => {});
            }
          }
        } catch {
          // Parse error — nothing to act on
        }
        resolve();
      });
    });

    req.on('error', () => resolve()); // Network error — silently skip
    req.write(payload);
    req.end();
  });
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Looks up push tokens by parent email and sends a notification.
 * Errors are fully swallowed — this must never break the calling route.
 *
 * @param {string} parentEmail
 * @param {string} title
 * @param {string} body
 * @param {Object} data
 */
async function sendNotificationToParentByEmail(parentEmail, title, body, data = {}) {
  try {
    const tokens = await getTokensByEmail(parentEmail);
    if (tokens.length > 0) {
      await sendPushNotifications(tokens, title, body, data);
    }
  } catch {
    // Non-fatal — never propagate push errors to the caller
  }
}

/**
 * Looks up push tokens by student ID (via parent_email on employees table)
 * and sends a notification to that student's parent.
 * Errors are fully swallowed.
 *
 * @param {number|string} studentId
 * @param {string} title
 * @param {string} body
 * @param {Object} data
 */
async function sendNotificationToParentByStudentId(studentId, title, body, data = {}) {
  try {
    const tokens = await getTokensByStudentId(studentId);
    if (tokens.length > 0) {
      await sendPushNotifications(tokens, title, body, data);
    }
  } catch {
    // Non-fatal — never propagate push errors to the caller
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  ensurePushTokensTable,
  getTokensByEmail,
  getTokensByStudentId,
  sendPushNotifications,
  sendNotificationToParentByEmail,
  sendNotificationToParentByStudentId,
};
