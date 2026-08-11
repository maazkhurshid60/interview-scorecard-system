import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ArrowLeft, Calendar as CalendarIcon, ScrollText, SlidersHorizontal, X } from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

dayjs.extend(relativeTime);

const ACTIONS = [
  'score_override', 'score_approve', 'question_edit', 'stage_toggle',
  'weight_change', 'disposition_change', 'final_decision',
  'provider_change', 'key_change', 'transcript_upload', 'consent_capture',
  'retention_purge',
];

/** Actions that change a hiring outcome get visual weight; the rest stay neutral. */
const ACTION_TONE = {
  final_decision: 'bg-[#d21e2b]/10 text-[#d21e2b] hover:bg-[#d21e2b]/10',
  disposition_change: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  score_override: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  score_approve: 'bg-green-100 text-green-800 hover:bg-green-100',
  retention_purge: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
};

const LIMIT = 50;
const EMPTY_FILTERS = { requisitionId: '', applicationId: '', userId: '', action: '', dateFrom: '', dateTo: '' };
const ALL = '__all__'; // Radix Select forbids an empty-string item value

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

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // What the server is actually filtered by right now — the draft above only
  // takes effect on Apply, so the "showing N" line must not react to typing.
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);

  async function load(currentPage = page, filterOverride = filters) {
    setLoading(true);
    try {
      const params = { page: currentPage, limit: LIMIT };
      Object.entries(filterOverride).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await api.get('/audit', { params });
      setEntries(res.data.entries);
      setTotal(res.data.total);
      setPage(res.data.page);
      setAppliedFilters(filterOverride);
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
    setFilters((prev) => ({ ...prev, [key]: value === ALL ? '' : value }));
  }

  function handleRequisitionFilterChange(value) {
    setFilters((prev) => ({ ...prev, requisitionId: value === ALL ? '' : value, applicationId: '' }));
  }

  function handleDateRangeChange(range) {
    setFilters((prev) => ({
      ...prev,
      dateFrom: range?.from ? dayjs(range.from).format('YYYY-MM-DD') : '',
      dateTo: range?.to ? dayjs(range.to).format('YYYY-MM-DD') : '',
    }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    load(1, EMPTY_FILTERS);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const activeCount = Object.values(appliedFilters).filter(Boolean).length;
  const draftDiffers = JSON.stringify(filters) !== JSON.stringify(appliedFilters);

  const dateRange = {
    from: filters.dateFrom ? dayjs(filters.dateFrom).toDate() : undefined,
    to: filters.dateTo ? dayjs(filters.dateTo).toDate() : undefined,
  };
  const dateRangeLabel = filters.dateFrom && filters.dateTo
    ? `${dayjs(filters.dateFrom).format('MMM D')} – ${dayjs(filters.dateTo).format('MMM D, YYYY')}`
    : filters.dateFrom
      ? `From ${dayjs(filters.dateFrom).format('MMM D, YYYY')}`
      : filters.dateTo
        ? `Until ${dayjs(filters.dateTo).format('MMM D, YYYY')}`
        : 'Date range';

  function DiffPanel({ entry }) {
    return (
      <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">Before</div>
          <pre className="overflow-x-auto rounded border border-border bg-background p-2 text-foreground">
            {JSON.stringify(entry.oldValue, null, 2) ?? '—'}
          </pre>
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">After</div>
          <pre className="overflow-x-auto rounded border border-border bg-background p-2 text-foreground">
            {JSON.stringify(entry.newValue, null, 2) ?? '—'}
          </pre>
        </div>
      </div>
    );
  }

  function ActionBadge({ action }) {
    return (
      <Badge variant="secondary" className={`whitespace-nowrap font-normal capitalize ${ACTION_TONE[action] || ''}`}>
        {action.replace(/_/g, ' ')}
      </Badge>
    );
  }

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${total.toLocaleString()} entr${total === 1 ? 'y' : 'ies'}${activeCount ? ' matching filters' : ''}`}
          </p>
        </div>
      </div>

      {/* ---------- filters ---------- */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</h2>
              {activeCount > 0 && (
                <Badge variant="secondary" className="font-normal">{activeCount} active</Badge>
              )}
            </div>
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X />
                Clear all
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Requisition</Label>
              <Select value={filters.requisitionId || ALL} onValueChange={handleRequisitionFilterChange}>
                <SelectTrigger><SelectValue placeholder="All requisitions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All requisitions</SelectItem>
                  {requisitions.map((r) => <SelectItem key={r._id} value={r._id}>{r.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Candidate</Label>
              <Select
                value={filters.applicationId || ALL}
                onValueChange={(v) => updateFilter('applicationId', v)}
                disabled={!filters.requisitionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={filters.requisitionId ? 'All candidates' : 'Pick a requisition first'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All candidates</SelectItem>
                  {applicationOptions.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Action</Label>
              <Select value={filters.action || ALL} onValueChange={(v) => updateFilter('action', v)}>
                <SelectTrigger><SelectValue placeholder="All actions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All actions</SelectItem>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a} value={a} className="capitalize">{a.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">User</Label>
              <Select value={filters.userId || ALL} onValueChange={(v) => updateFilter('userId', v)}>
                <SelectTrigger><SelectValue placeholder="All users" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All users</SelectItem>
                  {users.map((u) => <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date range</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal">
                    <CalendarIcon className="text-muted-foreground" />
                    <span className={filters.dateFrom || filters.dateTo ? '' : 'text-muted-foreground'}>
                      {dateRangeLabel}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="range" selected={dateRange} onSelect={handleDateRangeChange} numberOfMonths={2} />
                  {(filters.dateFrom || filters.dateTo) && (
                    <div className="border-t border-border p-2">
                      <Button variant="ghost" size="sm" onClick={() => handleDateRangeChange(undefined)}>
                        Clear dates
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-end">
              <Button
                onClick={() => load(1)}
                className="w-full bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
              >
                Apply filters
              </Button>
            </div>
          </div>

          {draftDiffers && (
            <p className="mt-2 text-xs text-amber-600">Filters changed — click Apply to update the results.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------- results ---------- */}
      {loading ? (
        <Card className="mt-4">
          <CardContent className="space-y-4 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-28 rounded-full" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 flex-1" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <ScrollText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {activeCount ? 'No entries match these filters' : 'No audit entries yet'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeCount
                  ? 'Try widening the date range or clearing a filter.'
                  : 'Every score, override and decision will be recorded here.'}
              </p>
            </div>
            {activeCount > 0 && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* md and up — table */}
          <Card className="mt-4 hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">When</TableHead>
                    <TableHead className="w-40">Action</TableHead>
                    <TableHead className="w-32">User</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-20 text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => {
                    const hasDiff = e.oldValue !== undefined || e.newValue !== undefined;
                    return (
                      <Fragment key={e._id}>
                        <TableRow className={expandedId === e._id ? 'border-b-0' : ''}>
                          <TableCell
                            className="whitespace-nowrap py-3 text-xs text-muted-foreground"
                            title={dayjs(e.timestamp).format('D MMM YYYY, HH:mm:ss')}
                          >
                            {dayjs(e.timestamp).fromNow()}
                          </TableCell>
                          <TableCell className="py-3"><ActionBadge action={e.action} /></TableCell>
                          <TableCell className="py-3 text-xs text-muted-foreground">{e.userId?.name || 'System'}</TableCell>
                          <TableCell className="py-3 text-xs text-muted-foreground">
                            <span className="line-clamp-2">{e.reason || '—'}</span>
                            {e.targetType && (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground/70">{e.targetType}</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            {hasDiff && (
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => setExpandedId(expandedId === e._id ? null : e._id)}
                              >
                                {expandedId === e._id ? 'Hide' : 'View'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedId === e._id && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="bg-muted/40 py-3">
                              <DiffPanel entry={e} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* below md — stacked cards */}
          <div className="mt-4 space-y-3 md:hidden">
            {entries.map((e) => {
              const hasDiff = e.oldValue !== undefined || e.newValue !== undefined;
              return (
                <Card key={e._id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <ActionBadge action={e.action} />
                      <span
                        className="flex-shrink-0 text-xs text-muted-foreground"
                        title={dayjs(e.timestamp).format('D MMM YYYY, HH:mm:ss')}
                      >
                        {dayjs(e.timestamp).fromNow()}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="text-foreground">{e.userId?.name || 'System'}</span>
                      {e.reason ? ` — ${e.reason}` : ''}
                    </p>
                    {e.targetType && <p className="mt-0.5 text-[11px] text-muted-foreground/70">{e.targetType}</p>}
                    {hasDiff && (
                      <>
                        <Button
                          variant="ghost" size="sm" className="mt-2 -ml-3"
                          onClick={() => setExpandedId(expandedId === e._id ? null : e._id)}
                        >
                          {expandedId === e._id ? 'Hide detail' : 'View detail'}
                        </Button>
                        {expandedId === e._id && (
                          <div className="mt-2 rounded-md bg-muted/40 p-3">
                            <DiffPanel entry={e} />
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ---------- pagination ---------- */}
      {!loading && total > LIMIT && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {total.toLocaleString()} entries
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load(page - 1)} disabled={page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => load(page + 1)} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
