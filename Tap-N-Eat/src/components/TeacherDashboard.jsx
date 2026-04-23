import AdminDashboard from './AdminDashboard';

export default function TeacherDashboard() {
  return (
    <AdminDashboard
      authStorageKey="teacherRole"
      loginHashRoute="#/teacher-login"
      activeSectionStorageKey="teacherActiveSection"
      portalLabel="Teacher"
      isTeacherPortal={true}
    />
  );
}
