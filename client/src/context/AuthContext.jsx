import { createContext, useContext, useEffect, useState } from 'react';
import api, { readHint, setSessionHint, clearSessionHint } from '../hooks/useApi';

const AuthContext = createContext(null);

/**
 * Holds the current user for the whole app. The login itself is kept in
 * HTTP-only cookies by the API, not in the browser's storage: on load, if this
 * browser has signed in before, GET /api/auth/me asks the API who is signed in
 * (renewing the session silently if the short-lived cookie has expired). Public
 * pages for candidates make no such request.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!readHint()) {
      setLoading(false);
      return;
    }
    api.get('/auth/me', { skipAuthRedirect: true })
      .then((res) => setUser(res.data.user))
      .catch(() => clearSessionHint())
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    setSessionHint();
    setUser(res.data.user);
    return res.data.user;
  }

  async function logout() {
    try {
      await api.post('/auth/logout', null, { skipAuthRedirect: true });
    } catch {
      // Even if the API cannot be reached, sign out here.
    }
    clearSessionHint();
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
