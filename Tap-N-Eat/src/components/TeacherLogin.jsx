import { useState } from 'react';
import logo from '../assets/cct-logo.png';
import './AdminLogin.css';

const TEACHER_USER = {
  username: 'teacher',
  password: 'teacher123',
};

export default function TeacherLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    const isValid =
      username.trim() === TEACHER_USER.username && password === TEACHER_USER.password;

    if (!isValid) {
      setError('Invalid teacher credentials');
      return;
    }

    localStorage.setItem('teacherRole', 'teacher');
    window.location.hash = '#/teacher';
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={logo} alt="Tap-N-Eat Logo" className="login-logo" />
        <div className="login-header">
          <h1>Teacher Portal</h1>
          <p>Sign in to manage students, meals, and RFID scans</p>
        </div>

        <div className="login-credentials">
          <span className="pill">teacher / teacher123</span>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter teacher username"
              autoComplete="username"
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
            />
          </div>
          {error && <div className="status-box error">{error}</div>}
          <div className="login-actions">
            <button type="submit" className="login-btn">
              Sign in to Teacher Portal
            </button>
          </div>
        </form>

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
