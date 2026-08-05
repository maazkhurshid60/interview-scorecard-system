import { Routes, Route } from 'react-router-dom';
import RequireAuth from './components/RequireAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Requisitions from './pages/Requisitions';
import RequisitionDetail from './pages/RequisitionDetail';
import Pipelines from './pages/Pipelines';
import Candidates from './pages/Candidates';
import InterviewRoom from './pages/InterviewRoom';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';

function ProtectedPage({ children }) {
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
      <Route path="/requisitions" element={<ProtectedPage><Requisitions /></ProtectedPage>} />
      <Route path="/requisitions/:id" element={<ProtectedPage><RequisitionDetail /></ProtectedPage>} />
      <Route path="/pipelines" element={<ProtectedPage><Pipelines /></ProtectedPage>} />
      <Route path="/candidates" element={<ProtectedPage><Candidates /></ProtectedPage>} />
      <Route path="/interview/:id" element={<ProtectedPage><InterviewRoom /></ProtectedPage>} />
      <Route path="/audit-log" element={<ProtectedPage><AuditLog /></ProtectedPage>} />
      <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
    </Routes>
  );
}
