import './App.css'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminDashboard from './components/AdminDashboard';
import VisitorOrder from './components/VisitorOrder';
import AdminLogin from './components/AdminLogin';
import TeacherLogin from './components/TeacherLogin';
import TeacherDashboard from './components/TeacherDashboard';
import ClientLogin from './components/ClientLogin';
import ClientDashboard from './components/ClientDashboard';
import ParentLogin from './components/ParentLogin';
import ParentDashboard from './components/ParentDashboard';

function App() {
  return (
    <div className="app">
      <HashRouter>
        <Routes>
          {/* Default landing: client portal */}
          <Route path="/" element={<Navigate to="/client-login" replace />} />

          {/* Client (platform owner) portal */}
          <Route path="/client-login" element={<ClientLogin />} />
          <Route path="/client" element={<ClientDashboard />} />

          {/* School portal */}
          <Route path="/admin-login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminDashboard />} />

          {/* Teacher portal */}
          <Route path="/teacher-login" element={<TeacherLogin />} />
          <Route path="/teacher" element={<TeacherDashboard />} />

          {/* Parent portal */}
          <Route path="/parent-login" element={<ParentLogin />} />
          <Route path="/parent" element={<ParentDashboard />} />

          {/* Visitor ordering */}
          <Route path="/visitor" element={<VisitorOrder />} />

          <Route path="*" element={<Navigate to="/client-login" replace />} />
        </Routes>
      </HashRouter>
    </div>
  )
}

export default App
