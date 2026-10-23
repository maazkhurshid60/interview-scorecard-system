import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Route guard: redirects to /login if there's no authenticated user, or / if role is unauthorized. */
export default function RequireAuth({ children, allowedRoles }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (allowedRoles && allowedRoles.length > 0) {
    const isAllowed = user?.role === 'owner' || allowedRoles.includes(user?.role);
    if (!isAllowed) {
      return <Navigate to="/" replace />;
    }
  }
  return children;
}
