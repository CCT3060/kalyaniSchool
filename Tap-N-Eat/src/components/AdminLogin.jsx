import { useState } from 'react';
import logo from '../assets/cct-logo.png';
import './AdminLogin.css';

const API_BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const { hostname, pathname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8000/api';
  if (pathname.includes('/qsr/') && pathname.includes('/Tap-N-Eat/frontend')) return '/qsr/Tap-N-Eat/backend/api';
  if (pathname.includes('/Tap-N-Eat/frontend')) return '/Tap-N-Eat/backend/api';
  return '/api';
})();

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  // Show cached school logo from last login session
  const cachedLogoRaw = (() => { try { return localStorage.getItem('adminSchoolLogoUrl') || ''; } catch { return ''; } })();
  const cachedSchoolName = (() => { try { return localStorage.getItem('adminSchoolName') || ''; } catch { return ''; } })();
  const resolveLogoUrl = (u) => {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    const base = API_BASE_URL.replace(/\/api$/, '');
    return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
  };
  const displayLogo = cachedLogoRaw ? resolveLogoUrl(cachedLogoRaw) : logo;

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`${API_BASE_URL}/school-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid credentials');
        return;
      }
      localStorage.setItem('adminRole',          data.role);
      localStorage.setItem('adminSchoolId',      String(data.school_id));
      localStorage.setItem('adminSchoolName',    data.school_name);
      localStorage.setItem('adminSchoolLogoUrl', data.school_logo_url || '');
      localStorage.setItem('adminFullName',      data.full_name);
      localStorage.setItem('adminAdminId',       String(data.admin_id));
      localStorage.setItem('adminPermissions',   JSON.stringify(data.permissions || {}));
      window.location.hash = '#/admin';
    } catch (err) {
      setError('Connection error. Please check the server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={displayLogo} alt={cachedSchoolName || 'Tap-N-Eat'} className="login-logo" style={cachedLogoRaw ? { borderRadius: 10 } : {}} />
        <div className="login-header">
          <h1>School Portal</h1>
          <p>Sign in with your school administrator credentials</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          {error && <div className="status-box error">{error}</div>}
          <div className="login-actions">
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in to School Portal'}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <a href="#/client-login" style={{ color: '#64748b', fontSize: '0.85rem', textDecoration: 'none' }}>
            ← Back to Client Portal
          </a>
        </div>

        <div style={{ borderTop: '1px solid #f1f5f9', marginTop: '1.5rem', paddingTop: '1.25rem', textAlign: 'center' }}>
          <a
            href="/privacy-policy.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0b5fa8', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600 }}
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
