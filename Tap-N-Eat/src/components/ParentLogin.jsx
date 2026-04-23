import { useState, useEffect } from 'react';
import logo from '../assets/cct-logo.png';
import './AdminLogin.css';
import './ClientLogin.css';

const API_BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const { hostname, pathname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8000/api';
  if (pathname.includes('/qsr/') && pathname.includes('/Tap-N-Eat/frontend')) return '/qsr/Tap-N-Eat/backend/api';
  if (pathname.includes('/Tap-N-Eat/frontend')) return '/Tap-N-Eat/backend/api';
  return '/api';
})();

function resolveLogoUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = API_BASE_URL.replace(/\/api$/, '').replace(/\/backend\/api$/, '/backend');
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

export default function ParentLogin() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('');
  const [schoolName, setSchoolName] = useState('');

  // Restore cached school branding from last session
  useEffect(() => {
    try {
      setSchoolLogoUrl(localStorage.getItem('parentSchoolLogoUrl') || '');
      setSchoolName(localStorage.getItem('parentSchoolName') || '');
    } catch {}
  }, []);

  // ── Login state ──
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Signup state ──
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suError, setSuError] = useState('');
  const [suLoading, setSuLoading] = useState(false);

  const displayLogo = schoolLogoUrl ? resolveLogoUrl(schoolLogoUrl) : logo;
  const displayName = schoolName || 'Parent Portal';

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/parent-portal?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || 'Login failed'); setLoading(false); return; }
      localStorage.setItem('parentEmail', data.data.parent.email);
      localStorage.setItem('parentName',  data.data.parent.full_name);
      localStorage.setItem('parentSchoolLogoUrl', (data.data.school && data.data.school.logo_url) || '');
      localStorage.setItem('parentSchoolName',    (data.data.school && data.data.school.name) || '');
      window.location.hash = '#/parent';
    } catch { setError('Unable to reach parent portal'); } finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setSuError('');
    if (suPassword !== suConfirm) { setSuError('Passwords do not match'); return; }
    setSuLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/parent-portal?action=signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: suName.trim(), email: suEmail.trim(), phone: suPhone.trim(), password: suPassword }),
      });
      const data = await response.json();
      if (!response.ok) { setSuError(data.error || 'Signup failed'); setSuLoading(false); return; }
      localStorage.setItem('parentEmail', data.data.parent.email);
      localStorage.setItem('parentName',  data.data.parent.full_name);
      localStorage.setItem('parentSchoolLogoUrl', (data.data.school && data.data.school.logo_url) || '');
      localStorage.setItem('parentSchoolName',    (data.data.school && data.data.school.name) || '');
      window.location.hash = '#/parent';
    } catch { setSuError('Unable to reach server'); } finally { setSuLoading(false); }
  };

  return (
    <div className="login-page client-login-page" style={{ background: 'radial-gradient(circle at 15% 15%, rgba(245,158,11,0.14), transparent 34%), radial-gradient(circle at 85% 10%, rgba(11,95,168,0.1), transparent 28%), #fffaf2' }}>
      <div className="login-card">
        <img src={displayLogo} alt={displayName} className="login-logo" style={{ borderRadius: schoolLogoUrl ? 10 : 0 }} />
        <div className="login-header">
          <div className="client-badge" style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)' }}>
            {displayName}
          </div>
          <h1>{mode === 'login' ? 'Parent Access' : 'Create Account'}</h1>
          <p>{mode === 'login' ? 'Sign in to track your child wallet and recharge anytime.' : "Register to manage your child's meals and wallet."}</p>
        </div>

        {/* Toggle */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <button type="button" onClick={() => { setMode('login'); setError(''); setSuError(''); }}
            style={{ flex: 1, padding: '10px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', background: mode === 'login' ? '#f59e0b' : '#f8fafc', color: mode === 'login' ? '#fff' : '#475569' }}>
            Sign In
          </button>
          <button type="button" onClick={() => { setMode('signup'); setError(''); setSuError(''); }}
            style={{ flex: 1, padding: '10px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', background: mode === 'signup' ? '#f59e0b' : '#f8fafc', color: mode === 'signup' ? '#fff' : '#475569' }}>
            Sign Up
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Email</label>
              <input className="login-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" autoComplete="username" disabled={loading} />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="login-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" disabled={loading} />
            </div>
            {error && <div className="status-box error">{error}</div>}
            <div className="login-actions">
              <button type="submit" className="login-btn" style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)' }} disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in to Parent Portal'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="login-form">
            <div className="form-group">
              <label>Full Name *</label>
              <input className="login-input" value={suName} onChange={(e) => setSuName(e.target.value)} placeholder="Your full name" required disabled={suLoading} />
            </div>
            <div className="form-group">
              <label>Email *</label>
              <input className="login-input" type="email" value={suEmail} onChange={(e) => setSuEmail(e.target.value)} placeholder="parent@example.com" required disabled={suLoading} />
            </div>
            <div className="form-group">
              <label>Phone (optional)</label>
              <input className="login-input" value={suPhone} onChange={(e) => setSuPhone(e.target.value)} placeholder="+91 98765 43210" disabled={suLoading} />
            </div>
            <div className="form-group">
              <label>Password *</label>
              <input className="login-input" type="password" value={suPassword} onChange={(e) => setSuPassword(e.target.value)} placeholder="Min 6 characters" required disabled={suLoading} />
            </div>
            <div className="form-group">
              <label>Confirm Password *</label>
              <input className="login-input" type="password" value={suConfirm} onChange={(e) => setSuConfirm(e.target.value)} placeholder="Repeat password" required disabled={suLoading} />
            </div>
            {suError && <div className="status-box error">{suError}</div>}
            <div className="login-actions">
              <button type="submit" className="login-btn" style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)' }} disabled={suLoading}>
                {suLoading ? 'Creating account…' : 'Create Account'}
              </button>
            </div>
            <p style={{ textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 12 }}>
              After signing up, ask your school to link your children to your account using this email address.
            </p>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <a href="#/client-login" style={{ color: '#64748b', fontSize: '0.85rem', textDecoration: 'none' }}>Back to Client Portal</a>
        </div>

        <div style={{ borderTop: '1px solid #f1f5f9', marginTop: '1.5rem', paddingTop: '1.25rem', textAlign: 'center' }}>
          <a
            href="/privacy-policy.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#f59e0b', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600 }}
          >
            Privacy Policy &amp; Terms
          </a>
          <div style={{ marginTop: '0.9rem', fontSize: '0.72rem', color: '#94a3b8' }}>
            Powered by
            <span style={{ fontWeight: 700, color: '#64748b', marginLeft: 4 }}>
              Comprehensive Cloud Technologies Pvt Ltd
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
