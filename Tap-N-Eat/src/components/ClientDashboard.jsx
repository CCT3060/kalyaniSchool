import { useState, useEffect } from 'react';
import logo from '../assets/logo.webp';
import './ClientDashboard.css';

const API_BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const { hostname, pathname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8000/api';
  if (pathname.includes('/qsr/') && pathname.includes('/Tap-N-Eat/frontend')) return '/qsr/Tap-N-Eat/backend/api';
  if (pathname.includes('/Tap-N-Eat/frontend')) return '/Tap-N-Eat/backend/api';
  return '/api';
})();

const api = (path, opts = {}) => fetch(`${API_BASE_URL}/${path}`, opts).then(async (r) => {
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  return { ok: r.ok, status: r.status, data: json };
});

export default function ClientDashboard() {
  const clientRole = (() => { try { return localStorage.getItem('clientRole') || ''; } catch { return ''; } })();

  useEffect(() => {
    if (!clientRole) window.location.hash = '#/client-login';
  }, [clientRole]);

  const [section, setSection]         = useState('schools');
  const [alert, setAlert]             = useState({ show: false, message: '', type: '' });

  // Schools state
  const [schools, setSchools]           = useState([]);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [schoolForm, setSchoolForm]       = useState({ school_name: '', school_code: '', address: '', phone: '', email: '' });
  const [showSchoolForm, setShowSchoolForm] = useState(false);
  const [editSchool, setEditSchool]       = useState(null);

  // Admins state
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [admins, setAdmins]                 = useState([]);
  const [adminLoading, setAdminLoading]     = useState(false);
  const [adminForm, setAdminForm]           = useState({ username: '', password: '', full_name: '', email: '', role: 'admin' });
  const [showAdminForm, setShowAdminForm]   = useState(false);
  const [editAdmin, setEditAdmin]           = useState(null);

  // Permissions state
  const PERM_SECTIONS = [
    { key: 'students',          label: 'Students' },
    { key: 'masters',           label: 'Grade & Division Masters' },
    { key: 'meal-categories',   label: 'Meal Categories' },
    { key: 'monthly-plans',     label: 'Monthly Meal Plans' },
    { key: 'meal-subscriptions',label: 'Subscriptions Report' },
    { key: 'reports',           label: 'Payment Reports' },
    { key: 'tuckshop',          label: 'Tuck Shop' },
    { key: 'rfid-scan',         label: 'RFID Scan' },
    { key: 'wallet',            label: 'Wallet Recharge' },
    { key: 'transactions',      label: 'Transaction History' },
  ];
  const [permSchoolId, setPermSchoolId]   = useState('');
  const [permAdmins, setPermAdmins]       = useState([]);
  const [permAdminId, setPermAdminId]     = useState('');
  const [permLoading, setPermLoading]     = useState(false);
  const [permSaving, setPermSaving]       = useState(false);
  const [permMap, setPermMap]             = useState({});
  const OPS = ['view','create','edit','delete','import','export'];

  const showAlert = (message, type = 'success') => {
    setAlert({ show: true, message, type });
    setTimeout(() => setAlert({ show: false, message: '', type: '' }), 5000);
  };

  // ── Schools ──────────────────────────────────────────────
  const loadSchools = async () => {
    setSchoolLoading(true);
    const { ok, data } = await api('schools');
    if (ok) setSchools(data.schools || []);
    else showAlert('Failed to load schools', 'error');
    setSchoolLoading(false);
  };

  useEffect(() => {
    if (section === 'schools' || section === 'admins') loadSchools();
  }, [section]);

  useEffect(() => {
    if (section === 'admins' && !selectedSchool && schools.length > 0) {
      setSelectedSchool(schools[0]);
    }
  }, [section, schools, selectedSchool]);

  useEffect(() => {
    if (selectedSchool) loadAdmins(selectedSchool.id);
  }, [selectedSchool]);

  const handleSchoolSubmit = async (e) => {
    e.preventDefault();
    if (!schoolForm.school_name || !schoolForm.school_code) {
      showAlert('School Name and Code are required', 'error'); return;
    }
    const isEdit = !!editSchool;
    const body = isEdit ? { ...schoolForm, id: editSchool.id } : schoolForm;
    const { ok, data } = await api('schools', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (ok) {
      showAlert(data.message || (isEdit ? 'School updated' : 'School created'), 'success');
      setShowSchoolForm(false);
      setEditSchool(null);
      setSchoolForm({ school_name: '', school_code: '', address: '', phone: '', email: '' });
      loadSchools();
    } else {
      showAlert(data.error || 'Failed to save school', 'error');
    }
  };

  const startEditSchool = (school) => {
    setEditSchool(school);
    setSchoolForm({
      school_name: school.school_name,
      school_code: school.school_code,
      address: school.address || '',
      phone: school.phone || '',
      email: school.email || '',
    });
    setShowSchoolForm(true);
  };

  const deactivateSchool = async (id) => {
    if (!window.confirm('Deactivate this school? Their admins will be unable to login.')) return;
    const { ok, data } = await api('schools', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (ok) { showAlert(data.message || 'School deactivated', 'success'); loadSchools(); }
    else showAlert(data.error || 'Failed to deactivate', 'error');
  };

  const reactivateSchool = async (id) => {
    const { ok, data } = await api('schools', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: 1 }),
    });
    if (ok) { showAlert('School reactivated', 'success'); loadSchools(); }
    else showAlert(data.error || 'Failed', 'error');
  };

  // Convert an /uploads/... path returned by the API into a fully qualified URL
  // so <img> tags render correctly regardless of where the frontend is hosted.
  const [pasteTargetSchool, setPasteTargetSchool] = useState(null);

  const resolveLogoUrl = (u) => {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    const base = API_BASE_URL.replace(/\/api$/, '').replace(/\/backend\/api$/, '/backend');
    return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
  };

  const uploadImageBlob = async (schoolId, blob, filename) => {
    if (blob.size > 5 * 1024 * 1024) { showAlert('Logo must be under 5 MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const { ok, data } = await api('schools/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: schoolId, filename: filename || 'logo.png', data_base64: reader.result }),
      });
      if (ok) { showAlert('Logo uploaded successfully', 'success'); loadSchools(); }
      else showAlert(data.error || 'Failed to upload logo', 'error');
    };
    reader.readAsDataURL(blob);
  };

  const handleLogoPick = (schoolId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      uploadImageBlob(schoolId, file, file.name);
    };
    input.click();
  };

  const handleLogoPaste = async (schoolId) => {
    // Try modern Clipboard API first (works in Chrome/Edge without Ctrl+V)
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            uploadImageBlob(schoolId, blob, `logo.${imgType.split('/')[1] || 'png'}`);
            return;
          }
        }
        showAlert('No image in clipboard. Copy an image first, then click Paste.', 'error');
        return;
      } catch {
        // Permission denied or not supported — fall through to Ctrl+V listener
      }
    }
    // Fallback: arm a one-shot paste event listener
    setPasteTargetSchool(schoolId);
    showAlert('Now press Ctrl+V to paste your logo image', 'success');
    const handler = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find(i => i.type.startsWith('image/'));
      if (imgItem) {
        e.preventDefault();
        const blob = imgItem.getAsFile();
        uploadImageBlob(schoolId, blob, `logo.${imgItem.type.split('/')[1] || 'png'}`);
      } else {
        showAlert('No image found in clipboard. Copy an image then try again.', 'error');
      }
      document.removeEventListener('paste', handler);
      setPasteTargetSchool(null);
    };
    document.addEventListener('paste', handler, { once: true });
    // Auto-cancel after 15s
    setTimeout(() => {
      document.removeEventListener('paste', handler);
      setPasteTargetSchool(null);
    }, 15000);
  };

  // ── Admins ──────────────────────────────────────────────
  const loadAdmins = async (schoolId) => {
    setAdminLoading(true);
    const { ok, data } = await api(`schools?resource=admins&school_id=${schoolId}`);
    if (ok) setAdmins(data.admins || []);
    else showAlert('Failed to load admins', 'error');
    setAdminLoading(false);
  };

  const loadPermAdmins = async (schoolId) => {
    const { ok, data } = await api(`schools?resource=admins&school_id=${schoolId}`);
    if (ok) {
      const list = data.admins || [];
      setPermAdmins(list);
      if (list.length > 0) {
        setPermAdminId(String(list[0].id));
        loadPermissions(list[0].id);
      } else {
        setPermAdminId('');
        setPermMap({});
      }
    }
  };

  const loadPermissions = async (adminId) => {
    if (!adminId) return;
    setPermLoading(true);
    const { ok, data } = await api(`permissions?admin_id=${adminId}`);
    if (ok) setPermMap(data.permissions || {});
    setPermLoading(false);
  };

  const handlePermToggle = (section, op) => {
    setPermMap((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] || {}),
        [`can_${op}`]: prev[section]?.[`can_${op}`] === 0 ? 1 : 0,
      },
    }));
  };

  const handleGrantAll = () => {
    const full = {};
    for (const s of PERM_SECTIONS) {
      full[s.key] = { can_view:1, can_create:1, can_edit:1, can_delete:1, can_import:1, can_export:1 };
    }
    setPermMap(full);
  };

  const handleRevokeAll = () => {
    const none = {};
    for (const s of PERM_SECTIONS) {
      none[s.key] = { can_view:0, can_create:0, can_edit:0, can_delete:0, can_import:0, can_export:0 };
    }
    setPermMap(none);
  };

  const handleSavePermissions = async () => {
    if (!permAdminId) return;
    setPermSaving(true);
    const sections = PERM_SECTIONS.map((s) => ({
      section:    s.key,
      can_view:   permMap[s.key]?.can_view   ?? 1,
      can_create: permMap[s.key]?.can_create ?? 1,
      can_edit:   permMap[s.key]?.can_edit   ?? 1,
      can_delete: permMap[s.key]?.can_delete ?? 1,
      can_import: permMap[s.key]?.can_import ?? 1,
      can_export: permMap[s.key]?.can_export ?? 1,
    }));
    const { ok, data } = await api('permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: parseInt(permAdminId), sections }),
    });
    if (ok) showAlert('Permissions saved successfully', 'success');
    else showAlert(data.error || 'Failed to save permissions', 'error');
    setPermSaving(false);
  };

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSchool) { showAlert('Select a school first', 'error'); return; }
    if (!adminForm.username || (!editAdmin && !adminForm.password) || !adminForm.full_name) {
      showAlert('Username, Password, and Full Name are required', 'error'); return;
    }
    const isEdit = !!editAdmin;
    const body = isEdit
      ? { id: editAdmin.id, ...adminForm }
      : { school_id: selectedSchool.id, ...adminForm };

    const { ok, data } = await api(`schools?resource=admins`, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (ok) {
      showAlert(data.message || (isEdit ? 'Admin updated' : 'Admin created'), 'success');
      setShowAdminForm(false);
      setEditAdmin(null);
      setAdminForm({ username: '', password: '', full_name: '', email: '', role: 'admin' });
      loadAdmins(selectedSchool.id);
    } else {
      showAlert(data.error || 'Failed to save admin', 'error');
    }
  };

  const startEditAdmin = (admin) => {
    setEditAdmin(admin);
    setAdminForm({
      username: admin.username,
      password: '',
      full_name: admin.full_name,
      email: admin.email || '',
      role: admin.role,
    });
    setShowAdminForm(true);
  };

  const toggleAdminActive = async (admin) => {
    const newState = admin.is_active ? 0 : 1;
    const { ok, data } = await api(`schools?resource=admins`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: admin.id, is_active: newState }),
    });
    if (ok) { showAlert(data.message || 'Updated', 'success'); loadAdmins(selectedSchool.id); }
    else showAlert(data.error || 'Failed', 'error');
  };

  const handleSchoolSelect = (school) => {
    setSelectedSchool(school);
    setSection('admins');
  };

  const roleBadgeClass = (role) => {
    if (role === 'admin') return 'role-badge role-admin';
    if (role === 'hr')    return 'role-badge role-hr';
    return 'role-badge role-security';
  };

  return (
    <div className="client-dashboard">
      {/* Sidebar */}
      <aside className="client-sidebar">
        <div className="client-sidebar-brand">
          <img src={logo} alt="logo" />
          <div className="client-portal-label">Client Portal</div>
        </div>

        <nav className="client-nav">
          <button
            className={`client-nav-item ${section === 'schools' ? 'active' : ''}`}
            onClick={() => { setSection('schools'); setSelectedSchool(null); }}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 21V12h6v9" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <span>Schools</span>
          </button>

          <button
            className={`client-nav-item ${section === 'admins' ? 'active' : ''}`}
            onClick={() => setSection('admins')}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
              <path d="M19 8v6m-3-3h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>School Admins</span>
            {selectedSchool && <span className="nav-school-badge">{selectedSchool.school_name}</span>}
          </button>

          <button
            className={`client-nav-item ${section === 'permissions' ? 'active' : ''}`}
            onClick={() => { setSection('permissions'); if (schools.length > 0 && !permSchoolId) { setPermSchoolId(String(schools[0].id)); loadPermAdmins(schools[0].id); } }}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
            </svg>
            <span>Permissions</span>
          </button>
        </nav>

        <div className="client-sidebar-footer">
          <button
            className="client-logout-btn"
            onClick={() => {
              try { localStorage.removeItem('clientRole'); localStorage.removeItem('clientFullName'); } catch {}
              window.location.hash = '#/client-login';
            }}
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M10 17l1.5 1.5a2 2 0 0 0 1.4.6H20a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-7.1a2 2 0 0 0-1.4.6L10 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 9l-3 3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="client-main">
        {/* Global alert */}
        {alert.show && (
          <div className={`client-alert client-alert-${alert.type}`}>{alert.message}</div>
        )}

        {/* ── SCHOOLS section ─────────────────────────── */}
        {section === 'schools' && (
          <div className="client-section">
            <div className="client-section-header">
              <div>
                <h1>Schools</h1>
                <p>Manage all registered schools on the platform</p>
              </div>
              <button className="client-btn-primary" onClick={() => { setShowSchoolForm(true); setEditSchool(null); setSchoolForm({ school_name: '', school_code: '', address: '', phone: '', email: '' }); }}>
                + Add School
              </button>
            </div>

            {/* School form modal */}
            {showSchoolForm && (
              <div className="client-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSchoolForm(false)}>
                <div className="client-modal">
                  <div className="client-modal-header">
                    <h2>{editSchool ? 'Edit School' : 'Add New School'}</h2>
                    <button className="client-modal-close" onClick={() => setShowSchoolForm(false)}>✕</button>
                  </div>
                  <form onSubmit={handleSchoolSubmit} className="client-form">
                    <div className="client-form-row">
                      <div className="client-form-group">
                        <label>School Name *</label>
                        <input value={schoolForm.school_name} onChange={(e) => setSchoolForm(p => ({ ...p, school_name: e.target.value }))} placeholder="e.g. Springfield Academy" required />
                      </div>
                      <div className="client-form-group">
                        <label>School Code *</label>
                        <input value={schoolForm.school_code} onChange={(e) => setSchoolForm(p => ({ ...p, school_code: e.target.value.toUpperCase() }))} placeholder="e.g. SPFLD01" required />
                      </div>
                    </div>
                    <div className="client-form-group">
                      <label>Address</label>
                      <textarea value={schoolForm.address} onChange={(e) => setSchoolForm(p => ({ ...p, address: e.target.value }))} placeholder="School address" rows={2} />
                    </div>
                    <div className="client-form-row">
                      <div className="client-form-group">
                        <label>Phone</label>
                        <input value={schoolForm.phone} onChange={(e) => setSchoolForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" />
                      </div>
                      <div className="client-form-group">
                        <label>Email</label>
                        <input type="email" value={schoolForm.email} onChange={(e) => setSchoolForm(p => ({ ...p, email: e.target.value }))} placeholder="admin@school.edu" />
                      </div>
                    </div>
                    <div className="client-form-actions">
                      <button type="button" className="client-btn-ghost" onClick={() => setShowSchoolForm(false)}>Cancel</button>
                      <button type="submit" className="client-btn-primary">{editSchool ? 'Save Changes' : 'Create School'}</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Schools table */}
            {schoolLoading ? (
              <div className="client-loader">Loading schools…</div>
            ) : schools.length === 0 ? (
              <div className="client-empty">
                <div className="client-empty-icon">🏫</div>
                <p>No schools yet. Click <strong>+ Add School</strong> to get started.</p>
              </div>
            ) : (
              <div className="client-table-wrap">
                <table className="client-table">
                  <thead>
                    <tr>
                      <th>Logo</th>
                      <th>School Name</th>
                      <th>Code</th>
                      <th>Contact</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schools.map((s) => (
                      <tr key={s.id} className={!s.is_active ? 'row-inactive' : ''}>
                        <td>
                          <div className="school-logo-cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {s.logo_url
                              ? <img src={resolveLogoUrl(s.logo_url)} alt={s.school_name} style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }} onError={(e) => { e.target.style.display='none'; }} />
                              : <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>No logo</div>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <button className="action-btn" title="Upload from file" onClick={() => handleLogoPick(s.id)} style={{ fontSize: 12 }}>
                                📁 Upload
                              </button>
                              <button
                                className="action-btn"
                                title="Paste from clipboard (Ctrl+V)"
                                onClick={() => handleLogoPaste(s.id)}
                                style={{ fontSize: 12, background: pasteTargetSchool === s.id ? '#dcfce7' : '', borderColor: pasteTargetSchool === s.id ? '#16a34a' : '', animation: pasteTargetSchool === s.id ? 'pulse 1s infinite' : 'none' }}
                              >
                                📋 Paste
                              </button>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="school-name-cell">
                            <div className="school-avatar">{s.school_name[0]}</div>
                            <div>
                              <div className="school-name">{s.school_name}</div>
                              {s.address && <div className="school-address">{s.address}</div>}
                            </div>
                          </div>
                        </td>
                        <td><code className="school-code">{s.school_code}</code></td>
                        <td>
                          <div>{s.phone || '—'}</div>
                          <div className="text-muted">{s.email || ''}</div>
                        </td>
                        <td>
                          <span className={`status-badge ${s.is_active ? 'status-active' : 'status-inactive'}`}>
                            {s.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div className="action-btns">
                            <button className="action-btn" title="Manage Admins" onClick={() => handleSchoolSelect(s)}>👤 Admins</button>
                            <button className="action-btn" title="Edit" onClick={() => startEditSchool(s)}>✏️</button>
                            {s.is_active
                              ? <button className="action-btn action-btn-danger" title="Deactivate" onClick={() => deactivateSchool(s.id)}>⛔</button>
                              : <button className="action-btn action-btn-success" title="Reactivate" onClick={() => reactivateSchool(s.id)}>✅</button>
                            }
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ADMINS section ─────────────────────────── */}
        {section === 'admins' && (
          <div className="client-section">
            <div className="client-section-header">
              <div>
                <h1>School Admins</h1>
                {selectedSchool
                  ? <p>Managing admins for <strong>{selectedSchool.school_name}</strong></p>
                  : <p>Select a school from the Schools tab to manage its admins</p>
                }
              </div>
              {selectedSchool && (
                <button className="client-btn-primary" onClick={() => { setShowAdminForm(true); setEditAdmin(null); setAdminForm({ username: '', password: '', full_name: '', email: '', role: 'admin' }); }}>
                  + Add Admin
                </button>
              )}
            </div>

            {!selectedSchool ? (
              <div className="client-empty">
                <div className="client-empty-icon">🏫</div>
                <p>Please go to <strong>Schools</strong> and click <strong>Admins</strong> on a school to manage its admins.</p>
              </div>
            ) : (
              <>
                {/* School selector pills */}
                <div className="school-pills">
                  {schools.map((s) => (
                    <button
                      key={s.id}
                      className={`school-pill ${selectedSchool?.id === s.id ? 'active' : ''}`}
                      onClick={() => { setSelectedSchool(s); }}
                    >
                      {s.school_name}
                    </button>
                  ))}
                </div>

                {/* Admin form modal */}
                {showAdminForm && (
                  <div className="client-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowAdminForm(false)}>
                    <div className="client-modal">
                      <div className="client-modal-header">
                        <h2>{editAdmin ? 'Edit Admin' : `Add Admin — ${selectedSchool.school_name}`}</h2>
                        <button className="client-modal-close" onClick={() => setShowAdminForm(false)}>✕</button>
                      </div>
                      <form onSubmit={handleAdminSubmit} className="client-form">
                        <div className="client-form-row">
                          <div className="client-form-group">
                            <label>Full Name *</label>
                            <input value={adminForm.full_name} onChange={(e) => setAdminForm(p => ({ ...p, full_name: e.target.value }))} placeholder="John Doe" required />
                          </div>
                          <div className="client-form-group">
                            <label>Email</label>
                            <input type="email" value={adminForm.email} onChange={(e) => setAdminForm(p => ({ ...p, email: e.target.value }))} placeholder="john@school.edu" />
                          </div>
                        </div>
                        <div className="client-form-row">
                          <div className="client-form-group">
                            <label>Username *</label>
                            <input value={adminForm.username} onChange={(e) => setAdminForm(p => ({ ...p, username: e.target.value }))} placeholder="john_spfld" required disabled={!!editAdmin} />
                          </div>
                          <div className="client-form-group">
                            <label>{editAdmin ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                            <input type="password" value={adminForm.password} onChange={(e) => setAdminForm(p => ({ ...p, password: e.target.value }))} placeholder={editAdmin ? 'Leave blank to keep current' : 'Set a password'} required={!editAdmin} />
                          </div>
                        </div>
                        <div className="client-form-group">
                          <label>Role</label>
                          <select value={adminForm.role} onChange={(e) => setAdminForm(p => ({ ...p, role: e.target.value }))}>
                            <option value="admin">Admin — full access</option>
                            <option value="hr">HR — read only</option>
                            <option value="security">Security — scan only</option>
                          </select>
                        </div>
                        <div className="client-form-actions">
                          <button type="button" className="client-btn-ghost" onClick={() => setShowAdminForm(false)}>Cancel</button>
                          <button type="submit" className="client-btn-primary">{editAdmin ? 'Save Changes' : 'Create Admin'}</button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {/* Admins table */}
                {adminLoading ? (
                  <div className="client-loader">Loading admins…</div>
                ) : admins.length === 0 ? (
                  <div className="client-empty">
                    <div className="client-empty-icon">👤</div>
                    <p>No admins yet for <strong>{selectedSchool.school_name}</strong>. Click <strong>+ Add Admin</strong>.</p>
                  </div>
                ) : (
                  <div className="client-table-wrap">
                    <table className="client-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Username</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {admins.map((a) => (
                          <tr key={a.id} className={!a.is_active ? 'row-inactive' : ''}>
                            <td>
                              <div className="admin-name-cell">
                                <div className="admin-avatar">{a.full_name[0]}</div>
                                <div>
                                  <div>{a.full_name}</div>
                                  <div className="text-muted">{a.email || ''}</div>
                                </div>
                              </div>
                            </td>
                            <td><code>{a.username}</code></td>
                            <td><span className={roleBadgeClass(a.role)}>{a.role}</span></td>
                            <td>
                              <span className={`status-badge ${a.is_active ? 'status-active' : 'status-inactive'}`}>
                                {a.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>
                              <div className="action-btns">
                                <button className="action-btn" onClick={() => startEditAdmin(a)}>✏️ Edit</button>
                                <button
                                  className={`action-btn ${a.is_active ? 'action-btn-danger' : 'action-btn-success'}`}
                                  onClick={() => toggleAdminActive(a)}
                                >
                                  {a.is_active ? '⛔ Deactivate' : '✅ Activate'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>            )}
          </div>
        )}

        {/* ── PERMISSIONS section ───────────────── */}
        {section === 'permissions' && (
          <div className="client-section">
            <div className="client-section-header">
              <div>
                <h1>Roles &amp; Permissions</h1>
                <p>Control what each admin user can view, create, edit, delete, import or export.</p>
              </div>
            </div>

            {/* School + Admin selectors */}
            <div className="client-form" style={{ maxWidth: 640, marginBottom: 24 }}>
              <div className="client-form-row">
                <div className="client-form-group">
                  <label>School</label>
                  <select
                    value={permSchoolId}
                    onChange={(e) => { setPermSchoolId(e.target.value); loadPermAdmins(parseInt(e.target.value)); }}
                  >
                    <option value="">— Select school —</option>
                    {schools.map((s) => <option key={s.id} value={s.id}>{s.school_name}</option>)}
                  </select>
                </div>
                <div className="client-form-group">
                  <label>Admin User</label>
                  <select
                    value={permAdminId}
                    onChange={(e) => { setPermAdminId(e.target.value); loadPermissions(parseInt(e.target.value)); }}
                    disabled={!permSchoolId || permAdmins.length === 0}
                  >
                    {permAdmins.length === 0
                      ? <option>No users found for this school</option>
                      : permAdmins.map((a) => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)
                    }
                  </select>
                </div>
              </div>
            </div>

            {!permAdminId ? (
              <div className="client-empty">
                <div className="client-empty-icon">🔒</div>
                <p>Select a school and a user above to configure permissions.</p>
                <p style={{ fontSize: 13, color: '#64748b' }}>All users including <strong>admin</strong>, <strong>hr</strong>, and <strong>security</strong> roles can be configured. Changes take effect on next login.</p>
              </div>
            ) : permLoading ? (
              <div className="client-loader">Loading permissions…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <button className="client-btn-primary" style={{ fontSize: 13, padding: '6px 14px' }} onClick={handleGrantAll}>Grant All</button>
                  <button className="client-btn-ghost"   style={{ fontSize: 13, padding: '6px 14px' }} onClick={handleRevokeAll}>Revoke All</button>
                </div>
                <div className="client-table-wrap">
                  <table className="client-table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 200 }}>Section</th>
                        {OPS.map((op) => (
                          <th key={op} style={{ textAlign: 'center', textTransform: 'capitalize' }}>{op}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERM_SECTIONS.map((sec) => (
                        <tr key={sec.key}>
                          <td><strong>{sec.label}</strong></td>
                          {OPS.map((op) => {
                            const granted = (permMap[sec.key]?.[`can_${op}`] ?? 1) === 1;
                            return (
                              <td key={op} style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={granted}
                                  onChange={() => handlePermToggle(sec.key, op)}
                                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 20 }}>
                  <button
                    className="client-btn-primary"
                    onClick={handleSavePermissions}
                    disabled={permSaving}
                    style={{ minWidth: 160 }}
                  >
                    {permSaving ? 'Saving…' : '💾 Save Permissions'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
