import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { ArrowLeft, Calendar as CalendarIcon } from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { formatDate } from '../utils/formatters';

const ACTIONS = [
  'score_override', 'score_approve', 'question_edit', 'stage_toggle',
  'weight_change', 'disposition_change', 'final_decision',
  'provider_change', 'key_change', 'transcript_upload', 'consent_capture',
  'retention_purge',
];

const LIMIT = 50;

export default function AuditLog() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [requisitions, setRequisitions] = useState([]);
  const [users, setUsers] = useState([]);
  const [applicationOptions, setApplicationOptions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const [filters, setFilters] = useState({
    requisitionId: '', applicationId: '', userId: '', action: '', dateFrom: '', dateTo: '',
  });

  async function load(currentPage = page, filterOverride = filters) {
    setLoading(true);
    try {
      const params = { page: currentPage, limit: LIMIT };
      Object.entries(filterOverride).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await api.get('/audit', { params });
      setEntries(res.data.entries);
      setTotal(res.data.total);
      setPage(res.data.page);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get('/requisitions').then((res) => setRequisitions(res.data.requisitions));
    api.get('/users').then((res) => setUsers(res.data.users));
    load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!filters.requisitionId) {
      setApplicationOptions([]);
      return;
    }
    api.get(`/requisitions/${filters.requisitionId}`).then((res) => {
      setApplicationOptions(res.data.applications.map((a) => ({ _id: a._id, name: a.candidateId?.name || 'Unknown' })));
    });
  }, [filters.requisitionId]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleRequisitionFilterChange(value) {
    setFilters((prev) => ({ ...prev, requisitionId: value, applicationId: '' }));
  }

  function handleDateRangeChange(range) {
    setFilters((prev) => ({
      ...prev,
      dateFrom: range?.from ? dayjs(range.from).format('YYYY-MM-DD') : '',
      dateTo: range?.to ? dayjs(range.to).format('YYYY-MM-DD') : '',
    }));
  }

  function applyFilters() {
    load(1);
  }

  function clearFilters() {
    const cleared = { requisitionId: '', applicationId: '', userId: '', action: '', dateFrom: '', dateTo: '' };
    setFilters(cleared);
    load(1, cleared);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const dateRange = {
    from: filters.dateFrom ? dayjs(filters.dateFrom).toDate() : undefined,
    to: filters.dateTo ? dayjs(filters.dateTo).toDate() : undefined,
  };
  const dateRangeLabel = filters.dateFrom && filters.dateTo
    ? `${dayjs(filters.dateFrom).format('MMM D, YYYY')} – ${dayjs(filters.dateTo).format('MMM D, YYYY')}`
    : filters.dateFrom
      ? `From ${dayjs(filters.dateFrom).format('MMM D, YYYY')}`
      : filters.dateTo
        ? `Until ${dayjs(filters.dateTo).format('MMM D, YYYY')}`
        : 'Date range';

  function DiffPanel({ entry }) {
    return (
      <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">Old</div>
          <pre className="overflow-x-auto rounded bg-white p-2 text-foreground">{JSON.stringify(entry.oldValue, null, 2)}</pre>
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">New</div>
          <pre className="overflow-x-auto rounded bg-white p-2 text-foreground">{JSON.stringify(entry.newValue, null, 2)}</pre>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          disabled={!canGoBack}
          className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-2xl font-semibold text-foreground">Audit Log</h1>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select value={filters.requisitionId || undefined} onValueChange={handleRequisitionFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="All requisitions" />
              </SelectTrigger>
              <SelectContent>
                {requisitions.map((r) => <SelectItem key={r._id} value={r._id}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.action || undefined} onValueChange={(v) => updateFilter('action', v)}>
              <SelectTrigger>
                <SelectValue placeholder="All actions" className="capitalize" />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => <SelectItem key={a} value={a} className="capitalize">{a.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={filters.applicationId || undefined}
              onValueChange={(v) => updateFilter('applicationId', v)}
              disabled={!filters.requisitionId}
            >
              <SelectTrigger>
                <SelectValue placeholder={filters.requisitionId ? 'All candidates' : 'Pick a requisition first'} />
              </SelectTrigger>
              <SelectContent>
                {applicationOptions.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.userId || undefined} onValueChange={(v) => updateFilter('userId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-left shadow-sm hover:bg-accent focus:outline-none focus:ring-1 focus:ring-[#d21e2b] focus:border-[#d21e2b]"
                >
                  <CalendarIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className={filters.dateFrom || filters.dateTo ? 'text-foreground' : 'text-muted-foreground'}>
                    {dateRangeLabel}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto">
                <Calendar mode="range" selected={dateRange} onSelect={handleDateRangeChange} numberOfMonths={2} />
                {(filters.dateFrom || filters.dateTo) && (
                  <div className="border-t border-border p-2">
                    <button
                      type="button"
                      onClick={() => handleDateRangeChange(undefined)}
                      className="text-xs text-[#d21e2b] hover:underline"
                    >
                      Clear dates
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={applyFilters} className="rounded-md bg-[#d21e2b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d21e2b]/90">
              Apply Filters
            </button>
            <button type="button" onClick={clearFilters} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent">
              Clear
            </button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No audit entries match these filters.</p>
      ) : (
        <>
          {/* md: and up — real table */}
          <Card className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Target</th>
                  <th className="px-4 py-2">Reason</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((e) => (
                  <Fragment key={e._id}>
                    <tr>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(e.timestamp)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">{e.action.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.userId?.name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.targetType}{e.targetId ? `: ${e.targetId}` : ''}</td>
                      <td className="max-w-xs px-4 py-3 text-xs text-muted-foreground">{e.reason || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {(e.oldValue !== undefined || e.newValue !== undefined) && (
                          <button
                            type="button" onClick={() => setExpandedId(expandedId === e._id ? null : e._id)}
                            className="text-xs text-[#d21e2b] hover:underline"
                          >
                            {expandedId === e._id ? 'Hide' : 'Diff'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === e._id && (
                      <tr>
                        <td colSpan={6} className="bg-accent/50 px-4 py-3">
                          <DiffPanel entry={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>

          {/* below md — stacked card per entry */}
          <div className="mt-4 space-y-3 md:hidden">
            {entries.map((e) => (
              <Card key={e._id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">{e.action.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(e.timestamp)}</span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div><span className="text-muted-foreground/70">User: </span>{e.userId?.name || '—'}</div>
                    <div><span className="text-muted-foreground/70">Target: </span>{e.targetType}{e.targetId ? `: ${e.targetId}` : ''}</div>
                    <div><span className="text-muted-foreground/70">Reason: </span>{e.reason || '—'}</div>
                  </div>
                  {(e.oldValue !== undefined || e.newValue !== undefined) && (
                    <>
                      <button
                        type="button" onClick={() => setExpandedId(expandedId === e._id ? null : e._id)}
                        className="mt-2 text-xs text-[#d21e2b] hover:underline"
                      >
                        {expandedId === e._id ? 'Hide diff' : 'Show diff'}
                      </button>
                      {expandedId === e._id && (
                        <div className="mt-2 rounded bg-accent/50 p-3">
                          <DiffPanel entry={e} />
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {total > LIMIT && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} ({total} entries)</span>
          <div className="flex gap-2">
            <button
              type="button" onClick={() => load(page - 1)} disabled={page <= 1}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button" onClick={() => load(page + 1)} disabled={page >= totalPages}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
