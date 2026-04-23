import { useEffect, useMemo, useState } from 'react';
import './VisitorOrder.css';

// Resolve API base dynamically so it works on Hostinger (/qsr/) and locally
const API_BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');

  const { hostname, origin, pathname } = window.location;

  // Local Vite dev (localhost:5173) should call Apache/PHP backend (localhost)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${origin.replace(/:\d+$/, '')}/Tap-N-Eat/backend/api`;
  }

  // Hostinger path like /qsr/Tap-N-Eat/frontend/
  if (pathname.includes('/qsr/') && pathname.includes('/Tap-N-Eat/frontend')) {
    return '/qsr/Tap-N-Eat/backend/api';
  }

  // Direct path like /Tap-N-Eat/frontend/
  if (pathname.includes('/Tap-N-Eat/frontend')) {
    return '/Tap-N-Eat/backend/api';
  }

  // Default: EC2/production — nginx proxies /api/
  if (pathname.includes('/qsr/')) return '/qsr/backend/api';
  return '/api';
})();

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);

    const existing = document.getElementById('razorpay-checkout-js');
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-js';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function suppressOtpCredentialsNoise() {
  const originalWarn = console.warn;
  const originalError = console.error;

  const shouldSuppress = (args) => {
    const msg = args.map((a) => String(a ?? '')).join(' ');
    return msg.includes('otp-credentials') && msg.includes('Unrecognized feature');
  };

  console.warn = (...args) => {
    if (shouldSuppress(args)) return;
    originalWarn(...args);
  };

  console.error = (...args) => {
    if (shouldSuppress(args)) return;
    originalError(...args);
  };

  return () => {
    console.warn = originalWarn;
    console.error = originalError;
  };
}

function getActiveSlot(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 6 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'closed';
}

const MEALS = [
  {
    id: 'breakfast',
    title: 'Breakfast',
    window: '06:00 - 11:00',
    price: 50,
    description: 'Start your day with a fresh breakfast meal.',
  },
  {
    id: 'lunch',
    title: 'Lunch',
    window: '11:00 - 16:00',
    price: 50,
    description: 'A balanced lunch meal for your midday break.',
  },
  {
    id: 'dinner',
    title: 'Dinner',
    window: '16:00 - 22:00',
    price: 50,
    description: 'A wholesome dinner meal to end the day.',
  },
];

export default function VisitorOrder() {
  const [now, setNow] = useState(() => new Date());
  const [selectedMealId, setSelectedMealId] = useState(() => {
    const slot = getActiveSlot(new Date());
    return slot === 'closed' ? 'lunch' : slot;
  });
  const [qty, setQty] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [busy, setBusy] = useState(false);

  const activeSlot = useMemo(() => getActiveSlot(now), [now]);
  const selectedMeal = useMemo(
    () => MEALS.find((m) => m.id === selectedMealId) || MEALS[1],
    [selectedMealId]
  );

  const totalAmount = useMemo(() => {
    const safeQty = Number.isFinite(Number(qty)) ? Math.max(1, Math.floor(Number(qty))) : 1;
    return selectedMeal.price * safeQty;
  }, [selectedMeal.price, qty]);

  const canOrder = activeSlot !== 'closed' && selectedMealId === activeSlot;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (activeSlot !== 'closed') {
      setSelectedMealId(activeSlot);
    }
  }, [activeSlot]);

  const createOrder = async ({ amountPaise, notes }) => {
    let res;
    try {
      res = await fetch(`${API_BASE_URL}/razorpay-create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: `VIS-${Date.now()}`,
          notes,
        }),
      });
    } catch (e) {
      throw new Error('Network error reaching payment API');
    }

    let data;
    let text;
    try {
      text = await res.text();
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error(`Payment API returned an invalid response (${res.status}). Body: ${text ? text.slice(0,120) : 'empty'}`);
    }

    if (!res.ok) {
      const msg = data?.message || data?.razorpay?.error?.description || 'Unable to create payment order';
      throw new Error(msg);
    }

    return data;
  };

  const verifyPayment = async ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
    const res = await fetch(`${API_BASE_URL}/razorpay-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature }),
    });

    let data;
    let text;
    try {
      text = await res.text();
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error(`Payment verification returned an invalid response (${res.status}). Body: ${text ? text.slice(0,120) : 'empty'}`);
    }

    if (!res.ok || !data?.verified) {
      throw new Error(data?.message || 'Payment verification failed');
    }

    return data;
  };

  const startPayment = async () => {
    if (!canOrder) {
      setStatus({
        type: 'error',
        message:
          activeSlot === 'closed'
            ? 'Ordering is currently closed. Please come back during meal hours.'
            : `Only ${MEALS.find((m) => m.id === activeSlot)?.title || 'current'} slot orders are allowed right now.`,
      });
      return;
    }

    const keyId = import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_SV4dT3pK23zxSP';

    setBusy(true);
    setStatus({ type: 'idle', message: '' });

    try {
      const restoreConsole = suppressOtpCredentialsNoise();
      const ok = await loadRazorpayScript();
      if (!ok) throw new Error('Failed to load Razorpay checkout');

      const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
      const amountPaise = totalAmount * 100;

      const order = await createOrder({
        amountPaise,
        notes: {
          meal: selectedMeal.title,
          slot: selectedMeal.id,
          qty: String(safeQty),
        },
      });

      const options = {
        key: keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Tap-N-Eat',
        description: `${selectedMeal.title} x${safeQty}`,
        order_id: order.id,
        prefill: {},
        notes: order.notes || {},
        theme: { color: '#0b5fa8' },
        method: {
          upi: paymentMethod === 'upi' || paymentMethod === 'scan',
          card: paymentMethod === 'card',
        },
        handler: async (response) => {
          try {
            await verifyPayment(response);
            setStatus({ type: 'success', message: `Payment successful. Order confirmed (${selectedMeal.title} x${safeQty}).` });
          } catch (e) {
            setStatus({ type: 'error', message: e?.message || 'Payment captured but verification failed.' });
          }
        },
        modal: {
          ondismiss: () => {
            setStatus({ type: 'idle', message: '' });
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        const msg = resp?.error?.description || resp?.error?.reason || 'Payment failed';
        setStatus({ type: 'error', message: msg });
      });
      rzp.open();

      // Restore console after checkout is initialized.
      setTimeout(restoreConsole, 1500);
    } catch (e) {
      setStatus({ type: 'error', message: e?.message || 'Unable to start payment' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="visitor-order">
      <div className="visitor-shell">
        <header className="visitor-top">
          <div>
            <h1 className="visitor-title">Order Meal</h1>
            <p className="visitor-sub">
              Current slot: <strong>{activeSlot === 'closed' ? 'Closed' : MEALS.find((m) => m.id === activeSlot)?.title}</strong>
              <span className="visitor-dot">•</span>
              <span>{now.toLocaleString()}</span>
            </p>
          </div>
          <a className="visitor-admin-link" href="#/admin">Admin</a>
        </header>

        <div className="meal-grid">
          {MEALS.map((meal) => {
            const isActive = activeSlot !== 'closed' && meal.id === activeSlot;
            const isSelected = selectedMealId === meal.id;
            return (
              <button
                key={meal.id}
                type="button"
                className={`meal-card ${isSelected ? 'selected' : ''} ${isActive ? 'active' : 'inactive'}`}
                onClick={() => setSelectedMealId(meal.id)}
              >
                <div className="meal-card-head">
                  <div>
                    <div className="meal-title">{meal.title}</div>
                    <div className="meal-window">{meal.window}</div>
                  </div>
                  <div className={`meal-badge ${isActive ? 'badge-live' : 'badge-soon'}`}>
                    {isActive ? 'Available now' : 'Not now'}
                  </div>
                </div>
                <div className="meal-desc">{meal.description}</div>
                <div className="meal-price">₹{meal.price.toFixed(2)}</div>
              </button>
            );
          })}
        </div>

        <section className="visitor-card">
          <div className="order-row">
            <div>
              <div className="field-label">Selected</div>
              <div className="field-value">{selectedMeal.title}</div>
            </div>
            <div className="qty">
              <label className="field-label" htmlFor="qty">Qty</label>
              <input
                id="qty"
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="total">
              <div className="field-label">Total</div>
              <div className="field-total">₹{totalAmount.toFixed(2)}</div>
            </div>
          </div>

          <div className="pay-row">
            <div className="pay-method">
              <div className="field-label">Pay with</div>
              <div className="method-buttons">
                <button
                  type="button"
                  className={`method-btn ${paymentMethod === 'upi' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('upi')}
                >
                  UPI
                </button>
                <button
                  type="button"
                  className={`method-btn ${paymentMethod === 'card' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('card')}
                >
                  Card
                </button>
                <button
                  type="button"
                  className={`method-btn ${paymentMethod === 'scan' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('scan')}
                >
                  Scan
                </button>
              </div>
              <div className="muted-note">Scan opens Razorpay UPI QR/Intent.</div>
            </div>

            <button
              type="button"
              className="pay-btn"
              onClick={startPayment}
              disabled={busy}
              title={!canOrder ? 'Ordering available only for current slot' : ''}
            >
              {busy ? 'Please wait…' : 'Pay & Place Order'}
            </button>
          </div>

          {status.type !== 'idle' && status.message && (
            <div className={`status-box ${status.type}`}>{status.message}</div>
          )}

          {!canOrder && (
            <div className="status-box info">
              {activeSlot === 'closed'
                ? 'Ordering is closed right now.'
                : `Only the current slot (${MEALS.find((m) => m.id === activeSlot)?.title}) can be ordered.`}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
