const express = require('express');
const router  = express.Router();
const axios   = require('axios');

// POST /api/razorpay-create-order
// Body: { amount (paise), currency?, receipt?, notes? }
router.post('/', async (req, res) => {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ message: 'Razorpay keys not configured on server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)' });
  }

  const amount   = parseInt(req.body.amount) || 0;
  const currency = (req.body.currency && typeof req.body.currency === 'string') ? req.body.currency : 'INR';
  const receipt  = (req.body.receipt  && typeof req.body.receipt  === 'string') ? req.body.receipt  : `VIS-${Date.now()}`;
  const notes    = (req.body.notes    && typeof req.body.notes    === 'object') ? req.body.notes    : {};

  if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

  try {
    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      { amount, currency, receipt, notes },
      { auth: { username: keyId, password: keySecret }, headers: { 'Content-Type': 'application/json' } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const data = err.response.data;
      return res.status(err.response.status).json({
        message: data?.error?.description || 'Razorpay order creation failed',
        razorpay: data,
      });
    }
    res.status(500).json({ message: 'Network error creating Razorpay order', error: err.message });
  }
});

module.exports = router;
