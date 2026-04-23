const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const pool    = require('../config/database');

async function ensureVisitorOrdersTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS visitor_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    razorpay_order_id VARCHAR(64) UNIQUE,
    razorpay_payment_id VARCHAR(64) DEFAULT NULL,
    amount INT NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'INR',
    meal_slot VARCHAR(50) DEFAULT NULL,
    qty INT DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'Paid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// POST /api/razorpay-verify
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
router.post('/', async (req, res) => {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const debug     = process.env.RAZORPAY_DEBUG === '1';

  if (!keyId || !keySecret) {
    return res.status(500).json({ verified: false, message: 'Razorpay keys not configured on server' });
  }

  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ verified: false, message: 'Missing required fields' });
  }

  // Verify HMAC signature
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const verified = expected === signature;

  if (!verified) {
    return res.status(400).json({ verified: false, message: 'Invalid signature' });
  }

  // Persist visitor order
  let persistError = null;
  try {
    await ensureVisitorOrdersTable();

    // Fetch order details from Razorpay
    const { data: orderData } = await axios.get(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`,
      { auth: { username: keyId, password: keySecret } }
    );

    const amount   = parseInt(orderData.amount) || 0;
    const currency = orderData.currency || 'INR';
    const notes    = orderData.notes || {};
    const meal     = notes.meal || notes.slot || null;
    const qty      = parseInt(notes.qty) || 1;

    await pool.query(
      `INSERT INTO visitor_orders (razorpay_order_id, razorpay_payment_id, amount, currency, meal_slot, qty, status)
       VALUES (?,?,?,?,?,?,'Paid')
       ON DUPLICATE KEY UPDATE razorpay_payment_id=VALUES(razorpay_payment_id), status='Paid'`,
      [orderId, paymentId, amount, currency, meal, qty]
    );
  } catch (err) {
    // Don't fail the verification response on persistence error
    persistError = err.message;
  }

  res.json({ verified: true, message: 'Verified', persist_error: debug ? persistError : null });
});

module.exports = router;
