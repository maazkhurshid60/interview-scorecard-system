import axios from 'axios';
import toast from 'react-hot-toast';
import { invalidateAfterChange } from '../lib/queryClient';

/**
 * Login lives in HTTP-only cookies set by the API (the page's scripts cannot
 * read them), so nothing secret is kept in localStorage. All that is stored is
 * a harmless flag saying "this browser has signed in", so public pages (the
 * application form) do not ask the API who is logged in.
 */
const SESSION_HINT_KEY = 'interview_scorecard_session';
const LEGACY_TOKEN_KEY = 'interview_scorecard_token'; // the old localStorage token, removed on load

function readHint() {
  try { return localStorage.getItem(SESSION_HINT_KEY) === '1'; } catch { return false; }
}
function setSessionHint() {
  try { localStorage.setItem(SESSION_HINT_KEY, '1'); } catch { /* storage unavailable: nothing to do */ }
}
function clearSessionHint() {
  try { localStorage.removeItem(SESSION_HINT_KEY); } catch { /* storage unavailable: nothing to do */ }
}
try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* ignore */ }

const baseURL = import.meta.env.VITE_API_URL;

/**
 * Shared Axios instance for every API call in the app.
 * - Points at the backend via VITE_API_URL (baked in at build time —
 *   set client/.env for dev, rebuild with a production value to deploy).
 * - Sends the login cookies with every request (withCredentials).
 * - The access cookie is short-lived. When the API answers 401 AUTH_ERROR the
 *   session is renewed once, silently, with the refresh cookie and the request
 *   is repeated. Only if that fails is the user sent to /login.
 * - Surfaces every other error as a toast with the server's message.
 * - A request can opt out of the redirect/toast with { skipAuthRedirect: true }.
 */
const api = axios.create({ baseURL, withCredentials: true });

// One renewal at a time: requests that expire together share the same renewal.
let renewal = null;
function renewSession() {
  if (!renewal) {
    // Plain axios on purpose: this call must not go through the retry logic below.
    renewal = axios.post(`${baseURL}/auth/refresh`, null, { withCredentials: true })
      .finally(() => { renewal = null; });
  }
  return renewal;
}

function endSession(skipRedirect) {
  clearSessionHint();
  if (!skipRedirect && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

api.interceptors.response.use(
  (response) => {
    // A change (anything that is not a GET) makes the cached lists it affects out of date.
    const method = String(response.config?.method || 'get').toLowerCase();
    if (method !== 'get') invalidateAfterChange(response.config?.url);
    return response;
  },
  async (error) => {
    const config = error.config || {};
    // A failed change may still have changed something, so the lists it could affect are re-read.
    if (String(config.method || 'get').toLowerCase() !== 'get') invalidateAfterChange(config.url);
    const status = error.response?.status;
    const url = config.url || '';
    const isAuthCall = ['/auth/login', '/auth/refresh', '/auth/logout'].some((path) => url.includes(path));

    // A 401 from our auth middleware means the access cookie is missing or expired.
    // External services (for example Google Calendar with an insufficient OAuth
    // scope) can also return 401 through the API, and those must show their error
    // instead of signing the HR user out.
    const isSessionAuthError = status === 401 && error.response?.data?.error === 'AUTH_ERROR';

    if (isSessionAuthError && !isAuthCall && !config._renewed) {
      config._renewed = true;
      try {
        await renewSession();
        return api(config); // repeat the original request with the fresh cookie
      } catch {
        endSession(config.skipAuthRedirect);
        return Promise.reject(error);
      }
    }

    if (isSessionAuthError && !isAuthCall) {
      endSession(config.skipAuthRedirect);
    } else if (!config.skipAuthRedirect) {
      const message = error.response?.data?.message || error.message || 'Something went wrong.';
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

export { readHint, setSessionHint, clearSessionHint };
export default api;
