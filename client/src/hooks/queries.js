import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import api from './useApi';
import { queryClient } from '../lib/queryClient';

/**
 * Cached reads. Each one has a name (the query key) under which TanStack Query keeps the answer,
 * and says how long that answer may be reused:
 *
 *   candidates list   60 s   changes with scoring and edits
 *   jobs list         30 s   includes live candidate counts
 *   departments       5 min  rarely change
 *   pipelines         5 min  rarely change
 *   settings          2 min  rarely change
 *
 * Anything that changes data through the API client clears the affected names straight away
 * (see invalidateAfterChange in lib/queryClient.js), so your own edits always show.
 *
 * Use the `...Options` functions with useQuery() inside components, and the `fetch...` helpers in
 * older code that loads data with plain async functions: both share the same cache.
 */

const MINUTE = 60 * 1000;

export const candidatesListOptions = (params) => queryOptions({
  queryKey: ['candidates', 'list', params],
  queryFn: async () => (await api.get('/candidates', { params })).data,
  staleTime: MINUTE,
  placeholderData: keepPreviousData, // keep showing the current page while the next one loads
});

/** @param {string} [status] e.g. 'open'; empty means every job. */
export const requisitionsListOptions = (status) => queryOptions({
  queryKey: ['requisitions', 'list', { status: status || null }],
  queryFn: async () => (await api.get('/requisitions', { params: status ? { status } : {} })).data,
  staleTime: 30 * 1000,
});

export const departmentsListOptions = () => queryOptions({
  queryKey: ['departments', 'list'],
  queryFn: async () => (await api.get('/departments')).data,
  staleTime: 5 * MINUTE,
});

export const pipelinesListOptions = () => queryOptions({
  queryKey: ['pipelines', 'list'],
  queryFn: async () => (await api.get('/pipelines')).data,
  staleTime: 5 * MINUTE,
});

export const settingsListOptions = () => queryOptions({
  queryKey: ['settings', 'list'],
  queryFn: async () => (await api.get('/settings')).data,
  staleTime: 2 * MINUTE,
});

/**
 * For code that is not a hook: gives the same { data } shape as api.get(), from the cache when it is fresh.
 * The data is copied, so changing it in place cannot change what is cached.
 */
async function fetchCached(options) {
  const data = await queryClient.fetchQuery(options);
  return { data: structuredClone(data) };
}

export const fetchRequisitionsList = (status) => fetchCached(requisitionsListOptions(status));
export const fetchDepartmentsList = () => fetchCached(departmentsListOptions());
export const fetchPipelinesList = () => fetchCached(pipelinesListOptions());
export const fetchSettingsList = () => fetchCached(settingsListOptions());
