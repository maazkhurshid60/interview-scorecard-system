import { Routes, Route } from 'react-router-dom';
import RequireAuth from './components/RequireAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Requisitions from './pages/Requisitions';
import RequisitionDetail from './pages/RequisitionDetail';
import RequisitionCandidates from './pages/RequisitionCandidates';
import Pipelines from './pages/Pipelines';
import Candidates from './pages/Candidates';
import InterviewRoom from './pages/InterviewRoom';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import Departments from './pages/Departments';
import Users from './pages/Users';
import CandidateApply from './pages/CandidateApply';
import CandidateAvailability from './pages/CandidateAvailability';

function ProtectedPage({ children, allowedRoles }) {
  return (
    <RequireAuth allowedRoles={allowedRoles}>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/apply/:id" element={<CandidateApply />} />
      <Route path="/interview/:id/availability" element={<CandidateAvailability />} />
      <Route path="/" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
      <Route path="/requisitions" element={<ProtectedPage><Requisitions /></ProtectedPage>} />
      <Route path="/requisitions/new" element={<ProtectedPage allowedRoles={['owner', 'admin', 'hiring_manager', 'recruiter']}><Requisitions /></ProtectedPage>} />
      <Route path="/requisitions/:id/edit" element={<ProtectedPage allowedRoles={['owner', 'admin', 'hiring_manager', 'recruiter']}><Requisitions /></ProtectedPage>} />
      <Route path="/requisitions/:id" element={<ProtectedPage><RequisitionDetail /></ProtectedPage>} />
      <Route path="/requisitions/:id/candidates" element={<ProtectedPage><RequisitionCandidates /></ProtectedPage>} />
      <Route path="/departments" element={<ProtectedPage><Departments /></ProtectedPage>} />
      <Route path="/pipelines" element={<ProtectedPage><Pipelines /></ProtectedPage>} />
      <Route path="/candidates" element={<ProtectedPage><Candidates /></ProtectedPage>} />
      <Route path="/interview/:id" element={<ProtectedPage><InterviewRoom /></ProtectedPage>} />
      <Route path="/users" element={<ProtectedPage allowedRoles={['owner', 'admin']}><Users /></ProtectedPage>} />
      <Route path="/audit-log" element={<ProtectedPage allowedRoles={['owner', 'admin']}><AuditLog /></ProtectedPage>} />
      <Route path="/settings" element={<ProtectedPage allowedRoles={['owner', 'admin']}><Settings /></ProtectedPage>} />
    </Routes>
  );
}
