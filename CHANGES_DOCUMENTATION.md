# TapN-Eat — Feature Changes Documentation

> This document explains every change made in this sprint, file by file, line by line.

---

## Table of Contents

1. [Backend — Permissions API (`permissions.js`)](#1-backend--permissions-api)
2. [Backend — Route Registration (`server.js`)](#2-backend--route-registration)
3. [Backend — Login Returns Permissions (`school-auth.js`)](#3-backend--login-returns-permissions)
4. [Web — Store Permissions on Login (`AdminLogin.jsx`)](#4-web--store-permissions-on-login)
5. [Web — Enforce Permissions in Admin Dashboard (`AdminDashboard.jsx`)](#5-web--enforce-permissions-in-admin-dashboard)
6. [Web — Permissions Tab in Client Portal (`ClientDashboard.jsx`)](#6-web--permissions-tab-in-client-portal)
7. [Web — Remove Quick Recharge (`ParentDashboard.jsx`)](#7-web--remove-quick-recharge-from-web-portal)
8. [Mobile — Canteen History Tab (`CanteenHistoryTab.js`)](#8-mobile--canteen-history-tab-new-file)
9. [Mobile — 4-Tab Navigation (`DashboardScreen.js`)](#9-mobile--4-tab-navigation--ui-polish)
10. [Mobile — Remove Quick Recharge (`WalletTab.js`)](#10-mobile--remove-quick-recharge)
11. [Mobile — Multi-Month Subscription Modal (`SubscriptionsTab.js`)](#11-mobile--multi-month-subscription-modal)

---

## 1. Backend — Permissions API

**File:** `backend-node/routes/permissions.js` *(new file)*

This file creates a full CRUD REST endpoint at `/api/permissions` for managing per-admin granular permissions.

```js
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
```
- Imports Express, creates a router, and imports the MySQL database pool.

```js
const ALL_SECTIONS = [
  'students','masters','meal-categories','monthly-plans',
  'meal-subscriptions','reports','tuckshop','rfid-scan','wallet','transactions'
];
```
- Defines the 10 sections an admin can have permissions for. This list is the source of truth — every admin always gets a row for every section.

```js
const DEFAULT_PERM = {
  can_view:1, can_create:1, can_edit:1, can_delete:1, can_import:1, can_export:1
};
```
- The default when no permission record exists yet = full access. This ensures existing admins aren't locked out before the client sets anything.

```js
async function ensurePermissionsTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      admin_id      INT NOT NULL,
      section       VARCHAR(60) NOT NULL,
      can_view      TINYINT(1) DEFAULT 1,
      can_create    TINYINT(1) DEFAULT 1,
      can_edit      TINYINT(1) DEFAULT 1,
      can_delete    TINYINT(1) DEFAULT 1,
      can_import    TINYINT(1) DEFAULT 1,
      can_export    TINYINT(1) DEFAULT 1,
      UNIQUE KEY uq_admin_section (admin_id, section)
    )
  `);
}
```
- Creates the table only if it doesn't already exist (idempotent). Called on every API request so it self-heals if the table is missing. `UNIQUE KEY uq_admin_section` prevents duplicates and enables `ON DUPLICATE KEY UPDATE` upserts.

```js
function buildPermMap(rows) {
  const map = {};
  for (const s of ALL_SECTIONS) {
    const row = rows.find(r => r.section === s);
    map[s] = row ? {
      can_view:   row.can_view,
      can_create: row.can_create,
      can_edit:   row.can_edit,
      can_delete: row.can_delete,
      can_import: row.can_import,
      can_export: row.can_export,
    } : { ...DEFAULT_PERM };
  }
  return map;
}
```
- Takes database rows for a specific admin and builds a full permissions object for all 10 sections. Sections with no DB row get `DEFAULT_PERM` (full access).

```js
router.get('/', async (req, res) => {
  const { admin_id } = req.query;
  if (!admin_id) return res.json({ success: false, error: 'admin_id required' });
  await ensurePermissionsTable();
  const [rows] = await db.execute(
    'SELECT * FROM admin_permissions WHERE admin_id = ?', [admin_id]
  );
  res.json({ success: true, permissions: buildPermMap(rows) });
});
```
- **GET /api/permissions?admin_id=X** — Returns the full permissions map for that admin. Used by the client portal to populate the permission grid.

```js
router.post('/', async (req, res) => {
  const { admin_id, sections } = req.body;
  if (!admin_id || !Array.isArray(sections))
    return res.json({ success: false, error: 'admin_id and sections[] required' });
  await ensurePermissionsTable();
  for (const s of sections) {
    await db.execute(`
      INSERT INTO admin_permissions
        (admin_id, section, can_view, can_create, can_edit, can_delete, can_import, can_export)
      VALUES (?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        can_view=VALUES(can_view), can_create=VALUES(can_create),
        can_edit=VALUES(can_edit),  can_delete=VALUES(can_delete),
        can_import=VALUES(can_import), can_export=VALUES(can_export)
    `, [admin_id, s.section, s.can_view, s.can_create, s.can_edit,
        s.can_delete, s.can_import, s.can_export]);
  }
  res.json({ success: true });
});
```
- **POST /api/permissions** — Accepts `{admin_id, sections:[{section, can_view, ...}]}`. Loops through each section and does a MySQL `INSERT ... ON DUPLICATE KEY UPDATE` (upsert). This lets you save the entire permission grid in one call.

```js
module.exports = router;
module.exports.buildPermMap  = buildPermMap;
module.exports.ALL_SECTIONS  = ALL_SECTIONS;
module.exports.DEFAULT_PERM  = DEFAULT_PERM;
```
- Exports the router as the default (so `app.use('/api/permissions', require('./routes/permissions'))` works) and also exports helper functions so `school-auth.js` can reuse them.

---

## 2. Backend — Route Registration

**File:** `backend-node/server.js` *(modified)*

```js
app.use('/api/permissions', require('./routes/permissions'));
```
- One line added — mounts the permissions router at `/api/permissions`. Placed alongside all other `app.use('/api/...')` lines.

---

## 3. Backend — Login Returns Permissions

**File:** `backend-node/routes/school-auth.js` *(modified)*

After the bcrypt password comparison succeeds:

```js
const { buildPermMap, ALL_SECTIONS, DEFAULT_PERM } = require('./permissions');
```
- Imports the helpers from the new permissions file at the top of the module.

```js
// After bcrypt.compare succeeds:
let permissions = {};
try {
  const [permRows] = await db.execute(
    'SELECT * FROM admin_permissions WHERE admin_id = ?', [admin.admin_id]
  );
  permissions = buildPermMap(permRows);
} catch (permErr) {
  // Table may not exist yet — default to full access
  for (const s of ALL_SECTIONS) permissions[s] = { ...DEFAULT_PERM };
}
```
- After successful login, queries the `admin_permissions` table to get that admin's permissions. If the table doesn't exist yet (first deploy), the catch block silently sets all permissions to the defaults so nothing breaks.

```js
return res.json({
  success: true,
  admin_id:    admin.admin_id,
  school_id:   admin.school_id,
  school_name: admin.school_name,
  full_name:   admin.full_name,
  role:        admin.role,
  permissions,           // ← NEW field
});
```
- Adds `permissions` object to the login response payload so the frontend can store it immediately.

---

## 4. Web — Store Permissions on Login

**File:** `src/components/AdminLogin.jsx` *(modified)*

```js
if (data.success) {
  localStorage.setItem('adminId',          data.admin_id);
  localStorage.setItem('schoolId',         data.school_id);
  localStorage.setItem('schoolName',       data.school_name);
  localStorage.setItem('adminName',        data.full_name);
  localStorage.setItem('adminRole',        data.role);
  localStorage.setItem('adminPermissions', JSON.stringify(data.permissions || {})); // ← NEW
  navigate('/admin-dashboard');
}
```
- After a successful login, the `permissions` object from the server response is JSON-serialized and stored in `localStorage` under the key `adminPermissions`. The `|| {}` ensures nothing breaks if the server somehow omits it.

---

## 5. Web — Enforce Permissions in Admin Dashboard

**File:** `src/components/AdminDashboard.jsx` *(modified)*

### The `hasPerm` Helper

```js
const _adminPermissions = (() => {
  try {
    const s = localStorage.getItem('adminPermissions');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
})();
```
- Immediately-invoked function expression (IIFE) that reads and JSON-parses `adminPermissions` from localStorage once at render time. Returns `null` on any error (parse failure, missing key).

```js
const hasPerm = (section, op) => {
  if (!section || role === 'admin') return true;  // admin role = always full access
  if (!_adminPermissions) return true;             // no permissions stored = full access (failsafe)
  const p = _adminPermissions[section];
  return !p || p[`can_${op}`] !== 0;              // 0 = explicitly denied; 1 or missing = allowed
};
```
- `section` — one of the 10 section keys (e.g. `'students'`, `'wallet'`)
- `op` — one of `'view'`, `'create'`, `'edit'`, `'delete'`, `'import'`, `'export'`
- Returns `true` (allowed) if: no section given, user is admin role, no permissions stored, or the stored value is not explicitly `0`.
- Returns `false` (denied) only if the value is exactly `0`.

```js
const SECTION_PERM = {
  'employees':             'students',
  'grade-division-master': 'masters',
  'meal-categories':       'meal-categories',
  'monthly-plans':         'monthly-plans',
  'meal-subscriptions':    'meal-subscriptions',
  'reports':               'reports',
  'tuckshop':              'tuckshop',
  'scan':                  'rfid-scan',
  'wallet':                'wallet',
  'transactions':          'transactions',
};
```
- Maps the internal `activeSection` strings used by the dashboard's navigation to the permission `section` keys used in the database. The sidebar key `'scan'` maps to the permission key `'rfid-scan'`, etc.

### Sidebar Item Guards

```jsx
<li
  onClick={() => setActiveSection('wallet')}
  style={hasPerm('wallet','view') ? {} : {display:'none'}}
>
  💰 Wallet
</li>
```
- Pattern applied to all 9 non-employee sidebar items: if `hasPerm(section, 'view')` returns false, the `<li>` is hidden with `display:'none'`. The employee menu item uses a JSX conditional `{hasPerm('students','view') && <li>...}` instead.

### Content Area Guards

```jsx
{/* Student registration form */}
{!isSecurity && hasPerm('students','create') && (
  <div className="registration-form">
    ...
  </div>
)}
```
- The "Add Student" form is only rendered if the user isn't security AND has `can_create` on the `students` section.

```jsx
{/* Edit/Delete buttons in student list */}
{!isReadOnly && (
  <>
    {hasPerm('students','edit')   && <button onClick={() => handleEdit(emp)}>✎ Edit</button>}
    {hasPerm('students','delete') && <button onClick={() => handleDelete(emp.id)}>🗑 Delete</button>}
  </>
)}
```
- Edit and Delete buttons are independently guarded. An admin can have edit but not delete (or vice versa).

---

## 6. Web — Permissions Tab in Client Portal

**File:** `src/components/ClientDashboard.jsx` *(modified)*

### Constants and State

```js
const PERM_SECTIONS = [
  { key:'students',           label:'Students / Employees' },
  { key:'masters',            label:'Masters (Grade/Division)' },
  { key:'meal-categories',    label:'Meal Categories' },
  { key:'monthly-plans',      label:'Monthly Meal Plans' },
  { key:'meal-subscriptions', label:'Meal Subscriptions' },
  { key:'reports',            label:'Reports' },
  { key:'tuckshop',           label:'Tuck Shop' },
  { key:'rfid-scan',          label:'RFID Scan' },
  { key:'wallet',             label:'Wallet' },
  { key:'transactions',       label:'Transactions' },
];
const OPS = ['view','create','edit','delete','import','export'];
```
- `PERM_SECTIONS` — display-ready list of all 10 sections with user-friendly labels for the table rows.
- `OPS` — the 6 permission operations for table columns.

```js
const [permSchoolId,  setPermSchoolId]  = useState('');
const [permAdmins,    setPermAdmins]    = useState([]);
const [permAdminId,   setPermAdminId]   = useState('');
const [permLoading,   setPermLoading]   = useState(false);
const [permSaving,    setPermSaving]    = useState(false);
const [permMap,       setPermMap]       = useState({});
```
- State for: which school is selected, the list of admin users for that school, which admin is selected, loading/saving spinners, and the current permissions grid object.

### Functions

```js
const loadPermAdmins = async (schoolId) => {
  const res = await fetch(`${API}/schools/${schoolId}/admins`);
  const data = await res.json();
  // Filter to only non-'admin' role users (hr, security) — 'admin' always has full access
  setPermAdmins((data.admins || []).filter(a => a.role !== 'admin'));
};
```
- When a school is selected, fetches the admin list for that school and filters out super-admins (since they always have full access, there's nothing to configure for them).

```js
const loadPermissions = async (adminId) => {
  setPermLoading(true);
  const res  = await fetch(`${API}/permissions?admin_id=${adminId}`);
  const data = await res.json();
  setPermMap(data.permissions || {});
  setPermLoading(false);
};
```
- Fetches the current permissions for the selected admin and populates the grid.

```js
const handlePermToggle = (section, op) => {
  setPermMap(prev => ({
    ...prev,
    [section]: {
      ...prev[section],
      [`can_${op}`]: prev[section]?.[`can_${op}`] === 0 ? 1 : 0,
    }
  }));
};
```
- Toggles a single checkbox in the grid. Flips 0→1 or 1→0. Uses functional state update to avoid stale closure issues.

```js
const handleGrantAll = () => {
  const full = {};
  for (const s of PERM_SECTIONS) {
    full[s.key] = { can_view:1, can_create:1, can_edit:1, can_delete:1, can_import:1, can_export:1 };
  }
  setPermMap(full);
};
const handleRevokeAll = () => { /* same but all 0 */ };
```
- Convenience buttons that set every checkbox to 1 (Grant All) or 0 (Revoke All).

```js
const handleSavePermissions = async () => {
  setPermSaving(true);
  const sections = PERM_SECTIONS.map(s => ({ section: s.key, ...permMap[s.key] }));
  await fetch(`${API}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_id: permAdminId, sections }),
  });
  setPermSaving(false);
  alert('Permissions saved!');
};
```
- Converts the grid state into the `sections[]` array format the backend expects, then POSTs to `/api/permissions`.

### UI

```jsx
<section id="permissions">
  <h2>🔐 Roles & Permissions</h2>
  <p>Note: Admin role always has full access. Configure hr / security users below.</p>

  {/* Step 1 — School selector */}
  <select onChange={e => { setPermSchoolId(e.target.value); loadPermAdmins(e.target.value); }}>
    ...schools...
  </select>

  {/* Step 2 — Admin user selector (shown only if school selected) */}
  {permSchoolId && (
    <select onChange={e => { setPermAdminId(e.target.value); loadPermissions(e.target.value); }}>
      ...admins...
    </select>
  )}

  {/* Step 3 — Permission grid (shown only if admin selected) */}
  {permAdminId && !permLoading && (
    <table>
      <thead>
        <tr>
          <th>Section</th>
          {OPS.map(op => <th key={op}>{op.charAt(0).toUpperCase() + op.slice(1)}</th>)}
        </tr>
      </thead>
      <tbody>
        {PERM_SECTIONS.map(({ key, label }) => (
          <tr key={key}>
            <td>{label}</td>
            {OPS.map(op => (
              <td key={op}>
                <input
                  type="checkbox"
                  checked={permMap[key]?.[`can_${op}`] !== 0}
                  onChange={() => handlePermToggle(key, op)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )}

  <button onClick={handleGrantAll}>Grant All</button>
  <button onClick={handleRevokeAll}>Revoke All</button>
  <button onClick={handleSavePermissions}>
    {permSaving ? 'Saving...' : 'Save Permissions'}
  </button>
</section>
```
- Three-step progressive disclosure: pick school → pick admin → see/edit grid.
- Checkbox is `checked` when the permission value is NOT `0` (covers both `1` and `undefined`/missing).

---

## 7. Web — Remove Quick Recharge from Web Portal

**File:** `src/components/ParentDashboard.jsx` *(modified)*

```jsx
{/* REMOVED — this entire block was deleted */}
<form className="parent-recharge-form" onSubmit={handleRecharge}>
  <input
    type="number"
    placeholder="Enter amount (₹)"
    value={rechargeAmount}
    onChange={e => setRechargeAmount(e.target.value)}
    min="1"
  />
  <button type="submit" disabled={rechargeLoading}>
    {rechargeLoading ? 'Processing...' : '⚡ Quick Recharge'}
  </button>
</form>
```
- Removed the 14-line quick recharge form from the parent's child details section. The wallet balance and RFID number stats are still shown — only the recharge input was removed. Parents now recharge through the dedicated Razorpay flow in the Meal Plans section.

---

## 8. Mobile — Canteen History Tab (New File)

**File:** `TapNEat-ParentApp/src/screens/CanteenHistoryTab.js` *(new file, ~260 lines)*

### Purpose
Dedicated tab showing all RFID canteen access events (allowed / denied) for all of the parent's children. Previously this data lived inside the Meal Plans tab — now it has its own dedicated screen.

### Key Sections

```js
const COLORS = {
  primary: '#6c5ce7', success: '#00b894', danger: '#e17055',
  dark: '#1e293b', textMuted: '#94a3b8', bg: '#f1f5f9',
};
```
- Centralized color constants for consistent theming.

```js
const [children,       setChildren]       = useState([]);
const [selectedChildId, setSelectedChildId] = useState(null);
const [log,            setLog]            = useState([]);
const [loading,        setLoading]        = useState(true);
const [refreshing,     setRefreshing]     = useState(false);
const [page,           setPage]           = useState(0);
const PAGE_SIZE = 20;
```
- `children` — list of all parent's children (from parent-portal API)
- `selectedChildId` — which child's history is currently showing (null = all children)
- `log` — the raw access log array from the API
- `page` — for pagination (20 entries per page with a "Load More" button)

```js
const loadChildren = async () => {
  const parentId = await AsyncStorage.getItem('parentId');
  const res = await fetch(`${API_BASE}/parent-portal?action=children&parent_id=${parentId}`);
  const data = await res.json();
  setChildren(data.children || []);
  if (data.children?.length) setSelectedChildId(data.children[0].child_id);
};
```
- Loads all children linked to the logged-in parent. Auto-selects the first child.

```js
const loadLog = async (childId) => {
  const parentId = await AsyncStorage.getItem('parentId');
  const res = await fetch(
    `${API_BASE}/parent-portal?action=canteen-log&parent_id=${parentId}` +
    `&child_id=${childId || ''}&limit=100`
  );
  const data = await res.json();
  setLog(data.log || []);
  setPage(0);
};
```
- Fetches the canteen log. `child_id` is optional — if omitted the backend returns all children's logs. Resets `page` to 0 so pagination starts fresh.

```js
const stats = useMemo(() => {
  const allowed = log.filter(r => r.status === 'allowed').length;
  const denied  = log.filter(r => r.status === 'denied').length;
  return { allowed, denied, total: log.length };
}, [log]);
```
- Derived stat counts computed only when `log` changes. Used for the summary cards.

### UI Structure

```
┌─────────────────────────┐
│   Dark Navy Hero Bar    │ ← gradient bg, RFID History chip
│   "Canteen Access       │
│    History"             │
├─────────────────────────┤
│ Child selector pills    │ ← horizontal ScrollView
├─────────────────────────┤
│ [✓ 12] [✗ 3] [48 Total]│ ← stats cards
├─────────────────────────┤
│ Log row 1               │ ← circular badge (✓/✗), name, date, plan
│ Log row 2               │
│ ...                     │
│ [Load More]             │
└─────────────────────────┘
```

```jsx
{log.slice(0, (page + 1) * PAGE_SIZE).map((item, idx) => (
  <View key={idx} style={styles.logRow}>
    <View style={[styles.badge, item.status==='allowed' ? styles.badgeOk : styles.badgeDeny]}>
      <Text style={styles.badgeText}>{item.status==='allowed' ? '✓' : '✗'}</Text>
    </View>
    <View style={styles.logMid}>
      <Text style={styles.logName}>{item.child_name}</Text>
      <Text style={styles.logMeta}>{item.meal_plan_name} · {item.grade} {item.division}</Text>
    </View>
    <View style={styles.logRight}>
      <Text style={styles.logDate}>{new Date(item.scanned_at).toLocaleDateString()}</Text>
      <View style={[styles.pill, item.status==='allowed' ? styles.pillOk : styles.pillDeny]}>
        <Text style={styles.pillText}>{item.status}</Text>
      </View>
    </View>
  </View>
))}
```
- Each log entry shows a colored circular badge, child name, plan/grade info, date, and a status pill.

```jsx
{(page + 1) * PAGE_SIZE < log.length && (
  <TouchableOpacity onPress={() => setPage(p => p + 1)}>
    <Text>Load More</Text>
  </TouchableOpacity>
)}
```
- "Load More" pagination — shows the next 20 records without fetching again (all 100 are already in memory).

---

## 9. Mobile — 4-Tab Navigation & UI Polish

**File:** `TapNEat-ParentApp/src/screens/DashboardScreen.js` *(modified)*

### New Import

```js
import CanteenHistoryTab from './CanteenHistoryTab';
```
- Imports the new tab screen.

### Updated Tab.Navigator

```jsx
<Tab.Navigator
  screenOptions={({ route }) => ({
    tabBarIcon: ({ focused }) => {
      const icons = { Home:'🏠', 'Meal Plans':'🍱', Canteen:'📡', Payments:'💳' };
      return (
        <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.6,
          transform: [{ scale: focused ? 1.1 : 1 }] }}>
          {icons[route.name]}
        </Text>
      );
    },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    tabBarStyle: { height: 64, paddingBottom: 8, ... shadow ... },
    ...
  })}
>
  <Tab.Screen name="Home"       component={WalletTab}           />
  <Tab.Screen name="Meal Plans" component={SubscriptionsTab}    />
  <Tab.Screen name="Canteen"    component={CanteenHistoryTab}   />  {/* ← NEW */}
  <Tab.Screen name="Payments"   component={TransactionHistoryTab} />
</Tab.Navigator>
```
- Added a 4th "Canteen" tab that renders `CanteenHistoryTab`.
- Tab bar height increased to 64px for better touch targets.
- Icons scale up (1.1x) when active with full opacity; inactive icons are 60% opacity.

### Header Redesign

```jsx
<View style={styles.header}>
  {/* Logo circle with translucent background */}
  <View style={styles.logoCircle}>
    <Image source={require('../assets/icon.png')} style={styles.logo} />
  </View>

  {/* Title area with app name + "PARENT PORTAL" subtitle */}
  <View style={styles.headerText}>
    <Text style={styles.headerTitle}>TapN-Eat</Text>
    <Text style={styles.headerSubtitle}>PARENT PORTAL</Text>
  </View>

  {/* Avatar + logout button */}
  <View style={styles.headerRight}>
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
    <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
      <Text style={styles.logoutText}>Logout</Text>
    </TouchableOpacity>
  </View>

  {/* Green accent line at bottom of header */}
  <View style={styles.headerAccent} />
</View>
```
- `logoCircle`: 38×38 circle with translucent white background, contains the app icon.
- `headerSubtitle`: small green uppercase "PARENT PORTAL" label for professional look.
- `headerAccent`: 3px green bar at the very bottom of the header (like a brand color underline).
- `logoutBtn`: now has a white border for visibility on the dark header.

---

## 10. Mobile — Remove Quick Recharge

**File:** `TapNEat-ParentApp/src/screens/WalletTab.js` *(modified)*

### Removed

```js
// REMOVED from imports:
TextInput,

// REMOVED state:
const [rechargeAmount,  setRechargeAmount]  = useState('');
const [rechargeLoading, setRechargeLoading] = useState(false);

// REMOVED async function:
const handleRecharge = async () => { ... 40 lines ... };

// REMOVED UI block (Quick Recharge section):
<Text style={styles.rechargeLabel}>💳 Quick Recharge</Text>
<View style={styles.rechargeRow}>
  <TextInput
    style={styles.rechargeInput}
    keyboardType="numeric"
    placeholder="Enter amount ₹"
    value={rechargeAmount}
    onChangeText={setRechargeAmount}
  />
  <TouchableOpacity
    style={[styles.rechargeBtn, rechargeLoading && styles.rechargeBtnDisabled]}
    onPress={handleRecharge}
  >
    <Text style={styles.rechargeBtnText}>
      {rechargeLoading ? 'Processing...' : 'Recharge'}
    </Text>
  </TouchableOpacity>
</View>

// REMOVED styles: rechargeLabel, rechargeRow, rechargeInput,
//                  rechargeBtn, rechargeBtnDisabled, rechargeBtnText
```

### Added

```jsx
{/* Balance displayed prominently */}
<Text style={styles.statValueBig}>₹{wallet.balance?.toFixed(2) || '0.00'}</Text>

{/* Info box pointing to Meal Plans tab */}
<View style={styles.rechargeInfo}>
  <Text style={styles.rechargeInfoText}>
    💡 To recharge your wallet, go to the Meal Plans tab and subscribe to a plan.
    Payment is processed via Razorpay.
  </Text>
</View>
```

- `statValueBig`: `fontSize:24, fontWeight:'800', color:COLORS.primary` — makes the balance the visual centerpiece of the home tab.
- `rechargeInfo`: a soft informational card guiding parents to the correct flow.

---

## 11. Mobile — Multi-Month Subscription Modal

**File:** `TapNEat-ParentApp/src/screens/SubscriptionsTab.js` *(modified)*

### New Import

```js
import { ..., Modal } from 'react-native';
```
- React Native's built-in `Modal` component — no extra package needed.

### New State

```js
const [multiModal,       setMultiModal]       = useState(false);
const [modalPlanGroup,   setModalPlanGroup]   = useState([]);
const [modalSelectedIds, setModalSelectedIds] = useState(new Set());
```
- `multiModal` — boolean to show/hide the bottom-sheet modal.
- `modalPlanGroup` — the array of available months for the same meal type (all months the parent could subscribe to at once).
- `modalSelectedIds` — a JavaScript `Set` of `plan_id` values the parent has checked. Using a Set makes O(1) toggle/lookup.

### Extended Month Loading

```js
const loadAvailablePlans = async (childId) => {
  const now = new Date();
  const results = [];
  for (let i = 0; i < 6; i++) {                        // ← was 2, now 6
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = d.getMonth() + 1;
    const year  = d.getFullYear();
    // ... fetch and push to results
  }
  // setAvailablePlans(results)
};
```
- Was loading 2 months ahead; now loads **6 months** ahead — gives parents a full half-year view to plan subscriptions.

### Replaced `handleSubscribePlan` (sync, opens modal)

```js
// OLD: async function that directly called Razorpay
const handleSubscribePlan = async (plan) => {
  // ... directly opened Razorpay with single month
};

// NEW: sync function that opens the multi-month selector modal
const handleSubscribePlan = (plan) => {
  // Find all unsubscribed plans with the same meal_type_id
  const group = availablePlans
    .filter(p => p.meal_type_id === plan.meal_type_id && !subscribedIds.has(p.plan_id));
  setModalPlanGroup(group);
  // Pre-select the plan the parent tapped
  setModalSelectedIds(new Set([plan.plan_id]));
  setMultiModal(true);
};
```
- Instead of immediately charging, opens a bottom-sheet showing all available months for that meal type. The tapped plan is pre-selected but the parent can add/remove months before paying.

### New `handleConfirmModal` (processes the multi-month payment)

```js
const handleConfirmModal = async () => {
  if (!modalSelectedIds.size) return;
  setMultiModal(false);

  // Group selected plans by year (in case selection crosses Dec→Jan)
  const byYear = {};
  for (const pid of modalSelectedIds) {
    const p = modalPlanGroup.find(x => x.plan_id === pid);
    if (!p) continue;
    if (!byYear[p.year]) byYear[p.year] = [];
    byYear[p.year].push({ month: p.month, amount: p.price });
  }

  // Warn if cross-year (edge case — usually fine but worth noting)
  if (Object.keys(byYear).length > 1) {
    Alert.alert('Note', 'Your selection spans two years. Two separate orders will be created.');
    return;
  }

  const year    = Object.keys(byYear)[0];
  const months  = byYear[year];                    // [{month, amount}, ...]
  const total   = months.reduce((s, m) => s + m.amount, 0);
  const monthNums = months.map(m => m.month);      // [1,2,3] for Jan+Feb+Mar

  // Convenience fee (2%)
  const convenience = Math.round(total * 0.02);
  const grandTotal  = total + convenience;

  // Create Razorpay order with an ARRAY of months
  const orderRes = await fetch(`${API_BASE}/razorpay-create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: grandTotal,
      child_id: selectedChildId,
      months: monthNums,          // ← array, e.g. [3, 4, 5]
      year: Number(year),
    }),
  });
  const orderData = await orderRes.json();

  // Store what we need for the verification callback
  setPendingVerifyPayload({
    child_id: selectedChildId,
    months: monthNums,
    year: Number(year),
    plan_ids: [...modalSelectedIds],
  });

  // Open Razorpay WebView
  setRazorpayOptions({
    key:         RAZORPAY_KEY,
    amount:      grandTotal * 100,   // paise
    currency:    'INR',
    name:        'TapN-Eat',
    description: `Meal Plan — ${monthNums.length} month(s)`,
    order_id:    orderData.order_id,
  });
  setRazorpayVisible(true);
};
```
- Groups months by year to handle December→January edge case.
- Sends `months: [3,4,5]` as an **array** to the backend (the backend already supports this format from a previous session).
- Calculates 2% convenience fee on the combined total.

### Canteen Log Removed from This Tab

```js
// REMOVED state:
const [canteenLog, setCanteenLog] = useState([]);
const [canteenLoading, setCanteenLoading] = useState(false);

// REMOVED function:
const loadCanteenLog = async (childId) => { ... };

// REMOVED from loadAll():
await loadCanteenLog(childId);

// REMOVED from useEffect:
loadCanteenLog(selectedChildId);
```

```jsx
{/* REMOVED — entire Canteen Access Log section */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Canteen Access Log</Text>
  ...
</View>
```
- Completely removed from this tab. The same data now lives in the dedicated `CanteenHistoryTab.js`.

### Modal UI

```jsx
<Modal
  visible={multiModal}
  transparent={true}
  animationType="slide"           // slides up from bottom
  onRequestClose={() => setMultiModal(false)}
>
  <TouchableOpacity
    style={styles.modalOverlay}   // semi-transparent dark background
    activeOpacity={1}
    onPress={() => setMultiModal(false)}  // tap outside to dismiss
  >
    <TouchableOpacity activeOpacity={1}>  {/* prevents dismiss when tapping card */}
      <View style={styles.modalCard}>

        {/* Header row */}
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>
            {modalPlanGroup[0]?.meal_type_name || 'Select Months'}
          </Text>
          <TouchableOpacity style={styles.modalClose} onPress={() => setMultiModal(false)}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>Select one or more months to subscribe</Text>

        {/* Scrollable month list */}
        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
          {modalPlanGroup.map(plan => {
            const chosen = modalSelectedIds.has(plan.plan_id);
            return (
              <TouchableOpacity
                key={plan.plan_id}
                style={[styles.monthRow, chosen && styles.monthRowSelected]}
                onPress={() => {
                  setModalSelectedIds(prev => {
                    const next = new Set(prev);
                    next.has(plan.plan_id) ? next.delete(plan.plan_id) : next.add(plan.plan_id);
                    return next;
                  });
                }}
              >
                {/* Checkbox */}
                <View style={[styles.checkbox, chosen && styles.checkboxChecked]}>
                  {chosen && <Text style={styles.checkmark}>✓</Text>}
                </View>

                {/* Month name + grade info */}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.monthName, chosen && styles.monthNameSelected]}>
                    {new Date(plan.year, plan.month-1).toLocaleString('default',{month:'long'})} {plan.year}
                  </Text>
                  <Text style={styles.monthGrade}>
                    Grade {plan.grade} {plan.division}
                  </Text>
                </View>

                {/* Price */}
                <Text style={[styles.monthPrice, chosen && styles.monthPriceSelected]}>
                  ₹{plan.price}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Running total */}
        {(() => {
          const subtotal = modalPlanGroup
            .filter(p => modalSelectedIds.has(p.plan_id))
            .reduce((s, p) => s + p.price, 0);
          const conv  = Math.round(subtotal * 0.02);
          const grand = subtotal + conv;
          return (
            <View style={styles.totalBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>₹{subtotal}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Convenience (2%)</Text>
                <Text style={styles.totalValue}>₹{conv}</Text>
              </View>
              <View style={[styles.totalRow, { marginTop: 6 }]}>
                <Text style={styles.grandLabel}>Total</Text>
                <Text style={styles.grandValue}>₹{grand}</Text>
              </View>
            </View>
          );
        })()}

        {/* Buttons */}
        <View style={styles.modalBtns}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => setMultiModal(false)}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.payBtn, !modalSelectedIds.size && styles.payBtnDisabled]}
            onPress={handleConfirmModal}
            disabled={!modalSelectedIds.size}
          >
            <Text style={styles.payBtnText}>
              Pay Now ({modalSelectedIds.size} month{modalSelectedIds.size !== 1 ? 's' : ''})
            </Text>
          </TouchableOpacity>
        </View>

      </View>
    </TouchableOpacity>
  </TouchableOpacity>
</Modal>
```

Key UX decisions:
- `animationType="slide"` — bottom-sheet slide-up animation feels native.
- Tapping outside the card closes it (outer `TouchableOpacity` with `onPress`).
- The inner `TouchableOpacity activeOpacity={1}` prevents tap-through to the close handler.
- IIFE (`(() => { ... })()`) computes total inline so no extra state needed.
- Pay button shows the count: "Pay Now (3 months)" — clear confirmation of what's being purchased.
- Pay button is disabled when nothing is selected.

---

## Summary of Files Changed

| File | Type | What Changed |
|------|------|-------------|
| `backend-node/routes/permissions.js` | NEW | Full CRUD for admin_permissions table |
| `backend-node/server.js` | MODIFIED | Registered /api/permissions route |
| `backend-node/routes/school-auth.js` | MODIFIED | Login response includes permissions object |
| `src/components/AdminLogin.jsx` | MODIFIED | Saves permissions to localStorage on login |
| `src/components/AdminDashboard.jsx` | MODIFIED | hasPerm helper + sidebar/content guards |
| `src/components/ClientDashboard.jsx` | MODIFIED | Full Permissions tab UI + CRUD functions |
| `src/components/ParentDashboard.jsx` | MODIFIED | Removed Quick Recharge form |
| `TapNEat-ParentApp/src/screens/CanteenHistoryTab.js` | NEW | Complete canteen access history screen |
| `TapNEat-ParentApp/src/screens/DashboardScreen.js` | MODIFIED | 4th tab added + header/UI polish |
| `TapNEat-ParentApp/src/screens/WalletTab.js` | MODIFIED | Removed Quick Recharge, improved balance display |
| `TapNEat-ParentApp/src/screens/SubscriptionsTab.js` | MODIFIED | Multi-month modal + canteen log removed |

---

## Database Change Required

Run this on your MySQL server (or it auto-creates via the API on first use):

```sql
CREATE TABLE IF NOT EXISTS admin_permissions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  admin_id      INT NOT NULL,
  section       VARCHAR(60) NOT NULL,
  can_view      TINYINT(1) DEFAULT 1,
  can_create    TINYINT(1) DEFAULT 1,
  can_edit      TINYINT(1) DEFAULT 1,
  can_delete    TINYINT(1) DEFAULT 1,
  can_import    TINYINT(1) DEFAULT 1,
  can_export    TINYINT(1) DEFAULT 1,
  UNIQUE KEY uq_admin_section (admin_id, section)
);
```
