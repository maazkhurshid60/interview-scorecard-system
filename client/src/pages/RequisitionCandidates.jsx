import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search, Users, X, ChevronDown } from 'lucide-react';
import api from '../hooks/useApi';
import { Button } from '@/components/ui/button';
import ScreeningBadge from '../components/ScreeningBadge';
import useRefreshWhile from '../hooks/useRefreshWhile';
import { isScreeningActive, isScreeningFailed } from '../lib/screening';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const DISPOSITION_LABEL = { HIRE: 'Hire', MAYBE: 'Maybe', NO_HIRE: 'No Hire' };

const DISPOSITION_BADGE = {
  IN_PROGRESS: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100',
  HIRE: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100',
  MAYBE: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100',
  NO_HIRE: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const PER_PAGE_STORAGE_KEY = 'requisition_candidates_per_page';

function getStoredPageSize() {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  try {
    const saved = localStorage.getItem(PER_PAGE_STORAGE_KEY) || localStorage.getItem('candidates_per_page');
    const parsed = Number(saved);
    if (PER_PAGE_OPTIONS.includes(parsed)) return parsed;
  } catch {
    // fallback
  }
  return DEFAULT_PAGE_SIZE;
}

function setStoredPageSize(size) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PER_PAGE_STORAGE_KEY, String(size));
  } catch {
    // ignore
  }
}

export default function RequisitionCandidates() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchingCandidates, setFetchingCandidates] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const ALL_DISPOSITIONS = ['in_progress', 'HIRE', 'MAYBE', 'NO_HIRE'];
  const [dispositionFilters, setDispositionFilters] = useState(ALL_DISPOSITIONS);
  const [stageFilter, setStageFilter] = useState('all');
  const [pageSize, setPageSize] = useState(() => getStoredPageSize());
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(() => ({ total: 0, page: 1, limit: getStoredPageSize(), totalPages: 1 }));
  const latestLoadRef = useRef(0);

  function toggleDispositionFilter(value) {
    setDispositionFilters((current) => (
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    ));
    setPage(1);
  }

  async function load(targetPage = page, targetLimit = pageSize, silent = false) {
    const requestId = ++latestLoadRef.current;
    const isInitialLoad = !data;
    if (isInitialLoad) setLoading(true);
    else if (!silent) setFetchingCandidates(true);

    try {
      const res = await api.get(`/requisitions/${id}`, {
        params: {
          page: targetPage,
          limit: targetLimit,
          search: debouncedSearch.trim() || undefined,
          disposition: dispositionFilters.length === 0 ? 'none' : dispositionFilters.length === 4 ? undefined : dispositionFilters.join(','),
          stageKey: stageFilter !== 'all' ? stageFilter : undefined,
        },
      });
      if (requestId !== latestLoadRef.current) return;
      setData(res.data);
      setPagination(res.data.pagination || { total: 0, page: 1, limit: targetLimit, totalPages: 1 });
      setPage(res.data.pagination?.page || 1);
    } finally {
      if (requestId === latestLoadRef.current) {
        setLoading(false);
        setFetchingCandidates(false);
      }
    }
  }

  function handlePageSizeChange(val) {
    const nextSize = Number(val);
    if (!PER_PAGE_OPTIONS.includes(nextSize)) return;
    setStoredPageSize(nextSize);
    setPageSize(nextSize);
    setPage(1);
    load(1, nextSize);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    load(1);
  }, [id, debouncedSearch, dispositionFilters, stageFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const applications = data?.applications || [];

  // While the AI is still scoring a visible application, refresh quietly until it finishes.
  useRefreshWhile(applications.some(isScreeningActive), () => load(page, pageSize, true));
  const stageLabels = useMemo(() => Object.fromEntries((data?.requisition?.stages || []).map((stage) => [stage.key, stage.label])), [data]);
  const statusCounts = data?.applicationStats || { total: 0, IN_PROGRESS: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 };

  const hasActiveFilters = Boolean(search || dispositionFilters.length < 4 || stageFilter !== 'all');

  if (loading) return <div className="space-y-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!data) return <div className="text-sm text-muted-foreground">Job opening not found.</div>;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{data.requisition.title} Candidates</h1>
            <p className="text-sm text-muted-foreground">
              {pagination.total} candidate{pagination.total === 1 ? '' : 's'} {hasActiveFilters ? 'match the current filters' : 'in this job opening'} · {statusCounts.IN_PROGRESS} in progress
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate(`/requisitions/${id}`)}>Open Job Opening</Button>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search candidates..."
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-9 w-full justify-between text-xs sm:w-44 border-input bg-background font-normal">
              AI Decision ({dispositionFilters.length}/4)
              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44 p-2">
            {[
              ['in_progress', 'In Progress'],
              ['HIRE', 'Hire'],
              ['MAYBE', 'Maybe'],
              ['NO_HIRE', 'No Hire'],
            ].map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={dispositionFilters.includes(value)} onCheckedChange={() => toggleDispositionFilter(value)} />
                {label}
              </label>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {(data?.requisition?.stages || []).length > 0 && (
          <Select value={stageFilter} onValueChange={(value) => { setStageFilter(value); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {(data.requisition.stages || []).map((stage) => (
                <SelectItem key={stage.key} value={stage.key}>
                  {stage.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setStatusFilter('all'); setStageFilter('all'); setPage(1); }}
            className="text-xs text-muted-foreground hover:text-foreground h-9 px-2"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Reset filters
          </Button>
        )}
      </div>

      <Card className="mt-4">
        <CardContent className="p-0">
          {applications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground">
              <Users className="h-6 w-6" />
              <p className="text-sm">
                {hasActiveFilters
                  ? 'No candidates match your current filter criteria.'
                  : 'No candidates found for this job opening.'}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => { setSearch(''); setStatusFilter('all'); setStageFilter('all'); setPage(1); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Current stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((application) => {
                  const disp = application.disposition;
                  const badgeClass = disp ? DISPOSITION_BADGE[disp] || '' : DISPOSITION_BADGE.IN_PROGRESS;
                  const badgeText = disp ? DISPOSITION_LABEL[disp] || disp : 'In progress';
                  return (
                    <TableRow key={application._id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{application.candidateId?.name || 'Candidate'}</div>
                        <div className="text-xs text-muted-foreground">{application.candidateId?.email || '—'}</div>
                      </TableCell>
                      <TableCell>{stageLabels[application.currentStageKey] || 'Initial screening'}</TableCell>
                      <TableCell>
                        {!disp && (isScreeningActive(application) || isScreeningFailed(application)) ? (
                          <ScreeningBadge application={application} />
                        ) : (
                          <Badge variant="outline" className={`font-medium ${badgeClass}`}>
                            {badgeText}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/requisitions/${id}?candidateId=${application.candidateId?._id || application.candidateId}`)}
                        >
                          Open application
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pagination.total > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} candidate{pagination.total === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Per page:</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-8 w-[72px] text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[72px] w-[72px]">
                  {PER_PAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={String(opt)} className="text-xs">
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(pagination.page - 1)}
                disabled={fetchingCandidates || pagination.page <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(pagination.page + 1)}
                disabled={fetchingCandidates || pagination.page >= pagination.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

