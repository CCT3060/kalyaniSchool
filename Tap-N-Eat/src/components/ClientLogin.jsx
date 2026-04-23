import { useState } from 'react';
import logo from '../assets/cct-logo.png';
import './AdminLogin.css';            // reuse existing login styles
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

// Hard-coded client portal credentials (super-admin / platform owner level)
// Change these or move to a DB-backed table for production use.
const CLIENT_USERS = {
  client: { password: 'client@123', fullName: 'Platform Admin' },
};

export default function ClientLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    const entry = CLIENT_USERS[username.trim()];
    if (!entry || entry.password !== password) {
      setError('Invalid credentials');
      return;
    }
    localStorage.setItem('clientRole', 'client');
    localStorage.setItem('clientFullName', entry.fullName);
    window.location.hash = '#/client';
  };

  return (
    <div className="login-page client-login-page">
      <div className="login-card">
        <img src={logo} alt="Tap-N-Eat Logo" className="login-logo" />
        <div className="login-header">
          <div className="client-badge">Client Portal</div>
          <h1>Platform Admin</h1>
          <p>Manage schools and their administrators</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
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
              placeholder="Enter password"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          {error && <div className="status-box error">{error}</div>}
          <div className="login-actions">
            <button type="submit" className="login-btn client-login-btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in to Client Portal'}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <a href="#/admin-login" style={{ color: '#64748b', fontSize: '0.85rem', textDecoration: 'none' }}>
            School Admin? Sign in here →
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
