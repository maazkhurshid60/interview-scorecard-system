import { QueryClient } from '@tanstack/react-query';

/**
 * The app-wide data cache (TanStack Query).
 *
 * Data read with GET requests is kept in memory for a while and reused instead of asking
 * the API again, for example when going from page 2 back to page 1 of the candidates.
 * Nothing is written to localStorage or cookies, and a page refresh starts empty.
 *
 * Defaults:
 *   - staleTime: how long a result counts as fresh (30 s unless a query says otherwise)
 *   - gcTime: how long an unused result is kept before it is thrown away (5 min)
 *   - no automatic retries: the API client (hooks/useApi.js) already shows an error message for every failure,
 *     and a retry would repeat it
 *   - no refetch on window focus / reconnect: this app refreshes what it needs itself
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/**
 * Which cached lists a change makes out of date, by the first part of the request URL.
 * "Out of date" lists that are on screen are re-read at once; the others are re-read the next time they are used.
 *
 *   /candidates      -> candidates, jobs (their candidate counts)
 *   /requisitions    -> jobs, candidates (the job filter and badges)
 *   /scoring, /interviews -> jobs, candidates (scores, stages and decisions show in both)
 *   /departments     -> departments, jobs (the department name shows on each job)
 *   /pipelines       -> pipelines
 *   /settings        -> settings
 *   /users           -> users
 *   /auth (login, logout) -> everything is thrown away, because the next person may see different data
 *   anything else    -> everything is marked out of date (the safe choice)
 */
const AFFECTED_BY = {
  candidates: [['candidates'], ['requisitions']],
  requisitions: [['requisitions'], ['candidates']],
  scoring: [['requisitions'], ['candidates']],
  interviews: [['requisitions'], ['candidates']],
  departments: [['departments'], ['requisitions']],
  pipelines: [['pipelines']],
  settings: [['settings']],
  users: [['users']],
};

export function invalidateAfterChange(url) {
  const path = String(url || '').split('?')[0].replace(/^\/+/, '');
  const area = path.split('/')[0];
  if (area === 'auth') {
    if (path === 'auth/login' || path === 'auth/logout') queryClient.clear();
    return;
  }
  const keys = AFFECTED_BY[area];
  if (!keys) {
    queryClient.invalidateQueries();
    return;
  }
  keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
}
