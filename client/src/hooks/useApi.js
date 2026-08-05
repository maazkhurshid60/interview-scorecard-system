import axios from 'axios';
import toast from 'react-hot-toast';

const TOKEN_STORAGE_KEY = 'interview_scorecard_token';

/**
 * Shared Axios instance for every API call in the app.
 * - Points at the backend via VITE_API_URL (baked in at build time —
 *   set client/.env for dev, rebuild with a production value to deploy).
 * - Attaches the stored JWT to every request.
 * - On 401, clears the stored session and redirects to /login (except for
 *   the login call itself, which legitimately returns 401 on bad credentials).
 * - Surfaces every other error as a toast with the server's message.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const isLoginRequest = error.config?.url?.includes('/auth/login');

    if (status === 401 && !isLoginRequest) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else {
      const message = error.response?.data?.message || error.message || 'Something went wrong.';
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

export { TOKEN_STORAGE_KEY };
export default api;
