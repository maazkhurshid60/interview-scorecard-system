import { createContext, useContext, useEffect, useState } from 'react';
import api, { TOKEN_STORAGE_KEY } from '../hooks/useApi';

const AuthContext = createContext(null);

/**
 * Holds the current session (user + JWT) for the whole app. Persists the
 * token to localStorage so a page refresh doesn't log the user out; on
 * mount, validates any stored token against GET /api/auth/me so a stale or
 * revoked token doesn't silently pretend to be a valid session.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => localStorage.removeItem(TOKEN_STORAGE_KEY))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, res.data.token);
    setUser(res.data.user);
    return res.data.user;
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

/** @returns {{user: object|null, loading: boolean, login: Function, logout: Function, isAuthenticated: boolean}} */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.');
  return ctx;
}
