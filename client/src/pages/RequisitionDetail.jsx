import RichTextViewer from '../components/RichTextViewer';
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Search, X, Users, Link2, ChevronDown, Play, Trash2, UserRoundPlus, ClipboardList, FileText, Pencil, Building2 } from 'lucide-react';
import api from '../hooks/useApi';
import { openStoredFile } from '../lib/fileAccess';
import ScreeningBadge from '../components/ScreeningBadge';
import useRefreshWhile from '../hooks/useRefreshWhile';
import { isScreeningActive, isScreeningFailed } from '../lib/screening';
import PipelineStepper from '../components/PipelineStepper';
import ScorecardEditor from '../components/ScorecardEditor';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { formatDate, formatDisposition, formatScore } from '../utils/formatters';
import SendOnboardingFormModal from '../components/SendOnboardingFormModal.jsx';
import OfferLetterDialog from '../components/OfferLetterDialog.jsx';
import { fromJobState } from '../lib/interviewNavigation';
import { useAuth } from '../context/AuthContext';
import { canDeleteRecords, canManageRequisitions, canMakeDecisions } from '../lib/permissions';

const DISPOSITION_BADGE = {
  HIRE: 'bg-green-100 text-green-800 hover:bg-green-100',
  MAYBE: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  NO_HIRE: 'bg-red-100 text-red-800 hover:bg-red-100',
};

const DECISION_LABEL = { hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const DECISION_BADGE = {
  hired: 'bg-green-100 text-green-800 hover:bg-green-100',
  rejected: 'bg-red-100 text-red-800 hover:bg-red-100',
  withdrawn: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
};

const STATUS_LABEL = { open: 'Open', paused: 'Paused', on_hold: 'Paused', closed: 'Closed', draft: 'Draft' };
const EMPLOYMENT_LABEL = { full_time: 'Full-Time', part_time: 'Part-Time', contract: 'Contract', internship: 'Internship', temporary: 'Temporary' };

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

export default function RequisitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDelete = canDeleteRecords(user); // only owners and admins may delete jobs or remove candidates
  const canManage = canManageRequisitions(user);
  const canDecide = canMakeDecisions(user);
  const [searchParams] = useSearchParams();
  const candidateIdFromUrl = searchParams.get('candidateId');
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingScorecard, setSavingScorecard] = useState(false);
  const [activeTab, setActiveTab] = useState(candidateIdFromUrl ? 'candidates' : 'job');
  const [scorecardData, setScorecardData] = useState(null);
  const [loadingScorecard, setLoadingScorecard] = useState(false);
  const [goingToInterview, setGoingToInterview] = useState(null);
  const [stageLinksByApp, setStageLinksByApp] = useState({});
  const [savingStatus, setSavingStatus] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [debouncedCandidateSearch, setDebouncedCandidateSearch] = useState('');
  const [dispositionFilters, setDispositionFilters] = useState(['in_progress', 'HIRE', 'MAYBE']);
  const [finalDecisionFilters, setFinalDecisionFilters] = useState(['undecided', 'hired', 'rejected', 'withdrawn']);
  const [fetchingCandidates, setFetchingCandidates] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);
  const [removeCandidateApp, setRemoveCandidateApp] = useState(null);
  const [removingCandidate, setRemovingCandidate] = useState(false);
  const [jobInfoOpen, setJobInfoOpen] = useState(true);

  const [openDecisionRowId, setOpenDecisionRowId] = useState(null);
  const [decisionDraft, setDecisionDraft] = useState('hired');
  const [decisionReasonDraft, setDecisionReasonDraft] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [offerFor, setOfferFor] = useState(null);
  const [onboardingCandidate, setOnboardingCandidate] = useState(null);

  const [viewCandidateFor, setViewCandidateFor] = useState(null);
  const [editCandidateFor, setEditCandidateFor] = useState(null);
  const [editCandidateForm, setEditCandidateForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [editCandidateResumeFile, setEditCandidateResumeFile] = useState(null);
  const [editingCandidate, setEditingCandidate] = useState(false);
  const latestLoadRef = useRef(0);

  function initials(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function copyContact(text, label) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard.`);
  }

  async function handleConfirmDecision(applicationId) {
    if (decisionDraft === 'rejected' && !decisionReasonDraft.trim()) {
      toast.error('A reason is required when rejecting a candidate.');
      return;
    }
    setSubmittingDecision(true);
    try {
      await api.patch(`/scoring/application/${applicationId}/decision`, {
        decision: decisionDraft,
        reason: decisionReasonDraft.trim() || undefined,
      });
      toast.success(`Decision recorded: ${DECISION_LABEL[decisionDraft]}.`);
      setOpenDecisionRowId(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record decision.');
    } finally {
      setSubmittingDecision(false);
    }
  }
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  async function handleOverrideInitialScreening(passed) {
    if (!overrideModalApp) return;
    setSavingOverride(true);
    try {
      await api.patch(`/scoring/application/${overrideModalApp._id}/override-initial-screening`, {
        passed,
        reason: overrideReason || (passed ? 'HR Manual Approval' : 'HR Manual Rejection'),
      });
      toast.success(passed ? 'Initial screening passed! Candidate advanced to Stage 1.' : 'Candidate marked as rejected.');
      setOverrideModalApp(null);
      setOverrideReason('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not override initial screening.');
    } finally {
      setSavingOverride(false);
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingRequisition, setDeletingRequisition] = useState(false);

  async function handleDeleteRequisition() {
    setDeletingRequisition(true);
    try {
      const res = await api.delete(`/requisitions/${id}`);
      toast.success(res.data?.message || `Job Opening "${requisition.title}" deleted.`);
      navigate('/requisitions');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not delete job opening.');
    } finally {
      setDeletingRequisition(false);
    }
  }

  const [pageSize, setPageSize] = useState(() => getStoredPageSize());
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(() => ({ total: 0, page: 1, limit: getStoredPageSize(), totalPages: 1 }));

  function openEditCandidate(candidate) {
    if (!candidate) return;
    setEditCandidateFor(candidate);
    setEditCandidateForm({
      name: candidate.name || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      notes: candidate.notes || '',
    });
    setEditCandidateResumeFile(null);
  }

  async function handleEditCandidate(e) {
    e.preventDefault();
    if (!editCandidateForm.name.trim() || !editCandidateForm.email.trim()) {
      toast.error('Name and Email are required.');
      return;
    }
    if (editCandidateForm.phone && !/^[0-9]{11}$/.test(editCandidateForm.phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }

    setEditingCandidate(true);
    try {
      const body = new FormData();
      body.append('name', editCandidateForm.name.trim());
      body.append('email', editCandidateForm.email.trim());
      body.append('phone', editCandidateForm.phone.trim());
      body.append('notes', editCandidateForm.notes);
      if (editCandidateResumeFile) body.append('resume', editCandidateResumeFile);

      await api.patch(`/candidates/${editCandidateFor._id}`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${editCandidateForm.name.trim()}'s profile was updated.`);
      setEditCandidateFor(null);
      setEditCandidateResumeFile(null);
      load();
    } catch {
      // API interceptor handles toast error messaging
    } finally {
      setEditingCandidate(false);
    }
  }

  function handleCandidateSearchChange(value) {
    setCandidateSearch(value);
    setPage(1);
  }

  function toggleDispositionFilter(value) {
    setDispositionFilters((current) => (
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    ));
    setPage(1);
  }

  function toggleFinalDecisionFilter(value) {
    setFinalDecisionFilters((current) => (
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
      const params = {
        page: targetPage,
        limit: targetLimit,
        search: debouncedCandidateSearch.trim() || undefined,
        disposition: dispositionFilters.length ? dispositionFilters.join(',') : 'none',
        finalDecision: finalDecisionFilters.length ? finalDecisionFilters.join(',') : 'none',
        candidateId: candidateIdFromUrl || undefined,
      };

      const res = await api.get(`/requisitions/${id}`, { params });
      if (requestId !== latestLoadRef.current) return;
      setData(res.data);
      if (res.data.pagination) {
        setPagination(res.data.pagination);
        setPage(res.data.pagination.page);
      }

      const appIds = (res.data?.applications || []).map((app) => app._id).filter(Boolean).join(',');
      const interviewParams = { requisitionId: id };
      if (appIds) interviewParams.applicationIds = appIds;

      const { data: interviewData } = await api.get('/interviews', { params: interviewParams });
      if (requestId !== latestLoadRef.current) return;
      const byApp = {};
      (interviewData.interviews || []).forEach((iv) => {
        if (!byApp[iv.applicationId]) byApp[iv.applicationId] = {};
        byApp[iv.applicationId][iv.stageKey] = iv._id;
      });
      setStageLinksByApp(byApp);

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
    const timeoutId = window.setTimeout(() => {
      setDebouncedCandidateSearch(candidateSearch);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [candidateSearch]);

  useEffect(() => {
    load(1);
  }, [id, debouncedCandidateSearch, dispositionFilters, finalDecisionFilters, candidateIdFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the AI is still scoring a visible application, refresh quietly until it finishes.
  useRefreshWhile((data?.applications || []).some(isScreeningActive), () => load(page, pageSize, true));

  useEffect(() => {
    if (activeTab !== 'scorecard' || scorecardData) return;
    setLoadingScorecard(true);
    api.get(`/requisitions/${id}/scorecard`)
      .then((res) => setScorecardData(res.data.scorecard || null))
      .finally(() => setLoadingScorecard(false));
  }, [activeTab, id, scorecardData]);

  useEffect(() => {
    setScorecardData(null);
    setActiveTab('job');
  }, [id]);

  async function handleSaveScorecard(stages) {
    const hasEmptyStage = stages.some((s) => !s.attributes || s.attributes.length === 0);
    if (hasEmptyStage) {
      toast.error('Each stage must have at least one question.');
      return;
    }
    setSavingScorecard(true);
    try {
      await api.patch(`/requisitions/${id}/scorecard`, { stages });
      toast.success('Scorecard saved.');
    } finally {
      setSavingScorecard(false);
    }
  }

  async function handleGoToInterview(app) {
    if (data?.requisition?.status !== 'open') {
      const status = data?.requisition?.status;
      toast.error(status === 'paused' || status === 'on_hold'
        ? 'This job opening is paused. Reopen it before starting a new interview stage.'
        : status === 'draft'
          ? 'This job opening is a draft. Open it before starting a new interview stage.'
          : 'This job opening is closed and cannot start new interview stages.');
      return;
    }
    const enabledList = (requisition?.stages || []).filter((s) => s.enabled);
    const allStagesPassed = enabledList.length > 0 && enabledList.every((s) => {
      const p = (app.stageProgress || []).find((pr) => pr.stageKey === s.key);
      return p && (p.passed === true || p.status === 'passed' || p.status === 'approved');
    });

    if (app.disposition === 'NO_HIRE' || (app.stageProgress || []).some((p) => p.status === 'failed')) {
      toast.error('This candidate has failed a stage and cannot proceed.');
      return;
    }
    if (allStagesPassed) {
      toast.error('This candidate has passed all stages.');
      return;
    }
    if (!app.currentStageKey) {
      toast.error('This candidate has no remaining stage — check their hiring stages status.');
      return;
    }
    setGoingToInterview(app._id);
    try {
      const res = await api.post(
        '/interviews',
        { applicationId: app._id, stageKey: app.currentStageKey },
        { validateStatus: () => true }
      );
      if (res.status === 201) {
        navigate(`/interview/${res.data.interview._id}`, { state: fromJobState(id) });
      } else if (res.status === 409 && res.data?.interviewId) {
        // Duplicate interview — open the one that already exists. Out-of-order
        // stage attempts also return 409, but carry no interviewId; those fall
        // through so their "Stage X must be approved first" message is shown.
        navigate(`/interview/${res.data.interviewId}`, { state: fromJobState(id) });
      } else {
        toast.error(res.data?.message || 'Could not open interview.');
      }
    } finally {
      setGoingToInterview(null);
    }
  }

  async function applyStatus(newStatus) {
    setSavingStatus(true);
    try {
      await api.patch(`/requisitions/${id}`, { status: newStatus });
      toast.success(`Job Opening marked ${STATUS_LABEL[newStatus].toLowerCase()}.`);
      load();
    } finally {
      setSavingStatus(false);
    }
  }

  function handleStatusChange(newStatus) {
    if (newStatus === data?.requisition?.status) return;
    // Closing starts the retention countdown — confirm before it's irreversible.
    if (newStatus === 'closed') { setPendingClose(true); return; }
    applyStatus(newStatus);
  }

  async function handleRemoveCandidate() {
    if (!removeCandidateApp?.candidateId?._id) return;
    setRemovingCandidate(true);
    try {
      const res = await api.delete(`/candidates/${removeCandidateApp.candidateId._id}/requisitions/${id}`);
      toast.success(res.data.message || 'Candidate removed from this requisition.');
      setRemoveCandidateApp(null);
      load();
    } finally {
      setRemovingCandidate(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 flex-shrink-0" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Skeleton className="mt-3 h-7 w-40" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="mt-6">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (!data) return <div className="text-muted-foreground">Job Opening not found.</div>;

  const { requisition, applications } = data;
  const scorecard = scorecardData;
  const canStartNewWork = requisition.status === 'open';
  const stageLabels = Object.fromEntries(requisition.stages.map((s) => [s.key, s.label]));
  // Applications are already filtered, ranked, and sliced by the server.
  const displayApplications = applications || [];
  const hasActiveCandidateFilter = Boolean(candidateSearch.trim())
    || dispositionFilters.length !== 4
    || finalDecisionFilters.length !== 4
    || Boolean(candidateIdFromUrl);
  const enabledStages = requisition.stages.filter((s) => s.enabled).length;
  const employmentDetails = {
    full_time: [['Working hours / shift', requisition.fullTimeDetails?.workingHours]],
    part_time: [['Weekly hours', requisition.partTimeDetails?.weeklyHours], ['Working hours / shift', requisition.partTimeDetails?.workingHours]],
    contract: [['Duration', requisition.contractDetails?.duration], ['Working hours', requisition.contractDetails?.workingHours], ['Payment / rate', requisition.contractDetails?.paymentRate]],
    internship: [['Duration', requisition.internshipDetails?.duration], ['Paid status', requisition.internshipDetails?.paidStatus === 'paid' ? 'Paid' : requisition.internshipDetails?.paidStatus === 'unpaid' ? 'Unpaid' : ''], ['Working hours', requisition.internshipDetails?.workingHours]],
    temporary: [['Start date', requisition.temporaryDetails?.startDate ? new Date(requisition.temporaryDetails.startDate).toLocaleDateString() : ''], ['End date', requisition.temporaryDetails?.endDate ? new Date(requisition.temporaryDetails.endDate).toLocaleDateString() : ''], ['Working hours', requisition.temporaryDetails?.workingHours]],
  }[requisition.employmentType] || [];
  const screeningCriteria = Array.isArray(requisition.initialScreeningCriteria) ? requisition.initialScreeningCriteria : [];

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" className="flex-shrink-0" onClick={() => navigate(-1)} disabled={!canGoBack}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">{requisition.title}</h1>
            {requisition.departmentId?.name && (
              <Badge variant="outline" className="text-xs font-normal text-slate-600 bg-slate-50 border-slate-200">
                <Building2 className="h-3 w-3 mr-1 text-slate-400" />
                {requisition.departmentId.name}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {enabledStages} stage{enabledStages === 1 ? '' : 's'} · {applications.length} candidate{applications.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 sm:flex-1 sm:justify-start">
          <span className="text-sm text-muted-foreground">Status</span>
          <Select value={requisition.status} onValueChange={handleStatusChange} disabled={savingStatus || !canManage}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-center">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="job">Job Opening</TabsTrigger>
              <TabsTrigger value="candidates">Candidates</TabsTrigger>
              <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2 sm:flex-1 sm:justify-end">
          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Edit job opening"
              aria-label="Edit job opening"
              onClick={() => navigate(`/requisitions/${requisition._id}/edit`, { state: fromJobState(requisition._id) })}
              className="h-8 w-8 text-slate-600 hover:text-slate-900 border-slate-300"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}

          {/* The span carries the tooltip: a disabled button does not show its own. */}
          <span
            className="inline-flex"
            title={canStartNewWork ? 'Copy candidate apply link' : 'Only open job openings have a public apply link'}
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy candidate apply link"
              onClick={() => {
                const url = `${window.location.origin}/apply/${requisition._id}`;
                navigator.clipboard.writeText(url);
                toast.success('Public candidate application link copied to clipboard!');
              }}
              disabled={!canStartNewWork}
              className="h-8 w-8 text-brand hover:text-brand"
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </span>

          {canDelete && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Delete job opening"
              aria-label="Delete job opening"
              onClick={() => setDeleteOpen(true)}
              className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {activeTab === 'job' && (
        <Card className="mt-6 overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex-row items-center justify-between py-4">
          <CardTitle>Job Opening Information</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setJobInfoOpen((open) => !open)} className="gap-1.5">
            {jobInfoOpen ? 'Hide details' : 'View details'}
            <ChevronDown className={`h-4 w-4 transition-transform ${jobInfoOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CardHeader>
        {jobInfoOpen && <CardContent className="space-y-7 pt-6">
          <section>
            <h3 className="text-sm font-semibold">Employment details</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Employment type</p><p className="mt-1 text-sm font-medium">{EMPLOYMENT_LABEL[requisition.employmentType] || requisition.employmentType}</p></div>
              {requisition.departmentId?.name && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Department</p>
                  <p className="mt-1 text-sm font-medium">{requisition.departmentId.name}</p>
                </div>
              )}
              {employmentDetails.filter(([, value]) => value).map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>)}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Work arrangement</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Arrangement</p><p className="mt-1 text-sm font-medium">{requisition.workplaceType ? `${requisition.workplaceType.charAt(0).toUpperCase()}${requisition.workplaceType.slice(1)}` : requisition.location || '—'}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{requisition.workplaceType === 'remote' ? 'Remote region / time zone' : 'Office location'}</p><p className="mt-1 text-sm font-medium">{requisition.workplaceType === 'remote' ? requisition.remoteRegion || 'Not specified' : requisition.officeLocation || requisition.location || 'Not specified'}</p></div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Job description</h3>
            <div className="mt-3 rounded-lg border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
              <RichTextViewer content={requisition.jobDescription} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Initial screening criteria</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {screeningCriteria.length ? screeningCriteria.map((criterion, index) => (
                <div key={`${criterion.criteria}-${index}`} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{criterion.criteria}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{criterion.requirement || `${criterion.minimumValue || '—'} to ${criterion.maximumValue || '—'}`}</p>
                  {criterion.allowVirtualUniversityOngoing && (
                    <Badge variant="secondary" className="mt-2 text-[11px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      Virtual University ongoing degree allowed
                    </Badge>
                  )}
                </div>
              )) : <p className="text-sm text-muted-foreground">No screening criteria configured.</p>}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Application questionnaire</h3>
            <div className="mt-3 space-y-3">
              {(requisition.questionnaire || []).length ? requisition.questionnaire.map((item, index) => {
                const question = typeof item === 'string' ? item : item.question;
                const idealAnswer = typeof item === 'object' ? item.idealAnswer : '';
                const requireIdeal = typeof item === 'object' ? Boolean(item.requireIdealAnswer) : false;
                return (
                  <div key={`${question}-${index}`} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{index + 1}. {question}</p>
                    {requireIdeal && idealAnswer ? (
                      <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-slate-700">Ideal answer benchmark:</span> {idealAnswer}</p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500 italic">Evaluated by AI against Job Description context</p>
                    )}
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No questionnaire configured.</p>}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Application settings</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Application deadline</p><p className="mt-1 text-sm font-medium">{requisition.applicationDeadline ? new Date(requisition.applicationDeadline).toLocaleDateString() : 'Not specified'}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">AI screening</p><p className="mt-1 text-sm font-medium">{requisition.aiScreeningEnabled ? 'Enabled' : 'Disabled'}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Hiring process template</p><p className="mt-1 text-sm font-medium">{requisition.pipelineTemplateName || 'Not specified'}</p></div>
            </div>
          </section>
        </CardContent>}
      </Card>
      )}

      {/* ---------- candidates ---------- */}
      {activeTab === 'candidates' && (
      <Card className="mt-6">
        <CardHeader className="space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>Candidates</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {pagination.total} candidate{pagination.total === 1 ? '' : 's'} {hasActiveCandidateFilter ? 'match the current filters' : 'attached to this job opening'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-between text-xs sm:w-44">
                    AI Decision ({dispositionFilters.length}/4)
                    <ChevronDown className="h-3.5 w-3.5" />
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
              {/* Final Decision filter is temporarily hidden.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-between text-xs sm:w-40">
                    Final Decision ({finalDecisionFilters.length}/4)
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44 p-2">
                  {[
                    ['undecided', 'No decision'],
                    ['hired', 'Hired'],
                    ['rejected', 'Rejected'],
                    ['withdrawn', 'Withdrawn'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted">
                      <Checkbox checked={finalDecisionFilters.includes(value)} onCheckedChange={() => toggleFinalDecisionFilter(value)} />
                      {label}
                    </label>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              */}
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={candidateSearch}
                  onChange={(e) => handleCandidateSearchChange(e.target.value)}
                  placeholder="Search by name or email…"
                  className="h-8 pl-8 pr-8 text-xs"
                />
                {candidateSearch && (
                  <button
                    type="button"
                    onClick={() => handleCandidateSearchChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate('/candidates')}
                title="Add candidate to this job opening"
                aria-label="Add candidate to this job opening"
              >
                <UserRoundPlus className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate(`/requisitions/${id}/candidates`)}
                title="View candidates for this job opening"
                aria-label="View candidates for this job opening"
              >
                <Users className="h-4 w-4" />
              </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          {pagination.total === 0 && !hasActiveCandidateFilter ? (
            <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No candidates yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Attach someone from the Candidates page to start interviewing.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/candidates')}>Go to Candidates</Button>
            </div>
          ) : displayApplications.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {candidateSearch.trim() ? `No candidates match “${candidateSearch}”.` : 'No candidates match this filter.'}
              </p>
              ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50">
                      <TableHead className="w-16 font-semibold text-center">Rank</TableHead>
                      <TableHead className="min-w-[220px] font-semibold text-center">Candidate</TableHead>
                      <TableHead className="w-32 font-semibold text-center">Availability</TableHead>
                      <TableHead className="min-w-[260px] font-semibold text-center">Hiring Stages</TableHead>
                      <TableHead className="w-28 text-center font-semibold">Weighted Total</TableHead>
                      <TableHead className="min-w-[135px] w-36 text-center font-semibold whitespace-nowrap">AI Decision</TableHead>
                      <TableHead className="min-w-[150px] font-semibold text-center">Final Decision</TableHead>
                      <TableHead className="w-24 text-center font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayApplications.map((app) => {
                      const rank = app.rank ?? null;
                      const weightedTotal = app.weightedTotal ?? null;
                      const disposition = app.disposition || null;
                      const finalDecision = app.finalDecision || null;
                      const finalDecisionReason = app.finalDecisionReason || '';

                      const appLinks = stageLinksByApp[app._id] || {};
                      const progressMap = Object.fromEntries(
                        (requisition?.stages || []).map((stage) => {
                          const p = (app.stageProgress || []).find((pr) => pr.stageKey === stage.key);
                          const interviewId = appLinks[stage.key];
                          const isFailed = p?.passed === false || p?.status === 'failed';
                          const isPassed = !isFailed && (p?.passed === true || p?.status === 'passed' || (p?.status === 'approved' && p?.passed !== false));
                          let status = isFailed ? 'failed' : isPassed ? 'passed' : p?.status || (interviewId ? 'scheduled' : 'pending');
                          return [stage.key, { stageKey: stage.key, status, passed: isFailed ? false : isPassed ? true : p?.passed }];
                        })
                      );
                      const enabledList = (requisition?.stages || []).filter((s) => s.enabled);
                      const allStagesPassed = enabledList.length > 0 && enabledList.every((s) => {
                        const p = (app.stageProgress || []).find((pr) => pr.stageKey === s.key);
                        return p && (p.passed === true || p.status === 'passed' || p.status === 'approved');
                      });
                      const hasFailed = disposition === 'NO_HIRE' || (app.stageProgress || []).some((p) => p.status === 'failed');
                      const isGoDisabled = !canStartNewWork || goingToInterview === app._id || !app.currentStageKey || hasFailed || allStagesPassed;

                      return (
                        <TableRow key={app._id} className="hover:bg-slate-50/50">
                          <TableCell className="font-semibold text-slate-600 align-middle">
                            {rank ? `#${rank}` : '—'}
                          </TableCell>

                          <TableCell className="align-middle">
                            <button
                              type="button"
                              onClick={() => setViewCandidateFor(app.candidateId)}
                              className="group flex flex-col text-left cursor-pointer rounded px-1.5 py-1 -mx-1.5 hover:bg-slate-100/80 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                              title={`View ${app.candidateId?.name || 'candidate'}'s details`}
                            >
                              <div className="font-medium text-foreground group-hover:text-brand transition-colors">
                                {app.candidateId?.name || app.candidateName || 'Unknown'}
                              </div>
                              <div className="text-xs text-muted-foreground break-all">{app.candidateId?.email || app.candidateEmail}</div>
                            </button>
                          </TableCell>

                          <TableCell className="text-center align-middle">
                            {app.opportunityDuration ? (
                              <Badge variant="secondary" className="font-normal text-[11px] bg-slate-100 text-slate-700 border-slate-200">
                                {app.opportunityDuration}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="align-middle">
                            <PipelineStepper
                              stages={requisition.stages}
                              progress={progressMap}
                              stageLinks={stageLinksByApp[app._id]}
                              linkState={fromJobState(id)}
                              currentStageKey={hasFailed || allStagesPassed ? null : app.currentStageKey}
                              onStartStage={() => handleGoToInterview(app)}
                              startingStageKey={goingToInterview === app._id ? app.currentStageKey : null}
                              disabled={!canStartNewWork}
                              hideScrollbar
                            />
                          </TableCell>

                          <TableCell className="text-center font-semibold text-slate-800 align-middle">
                            {formatScore(weightedTotal)}
                          </TableCell>

                          <TableCell className="text-center align-middle whitespace-nowrap">
                            {disposition ? (
                              <Badge variant="secondary" className={`font-normal ${DISPOSITION_BADGE[disposition] || ''}`}>
                                {formatDisposition(disposition)}
                              </Badge>
                            ) : (isScreeningActive(app) || isScreeningFailed(app)) ? (
                              <ScreeningBadge application={app} />
                            ) : (
                              <span className="text-xs text-muted-foreground">In progress</span>
                            )}
                          </TableCell>

                          <TableCell className="align-middle">
                            {finalDecision && openDecisionRowId !== app._id ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="secondary" className={`font-normal w-fit ${DECISION_BADGE[finalDecision] || ''}`}>
                                    {DECISION_LABEL[finalDecision] || finalDecision}
                                  </Badge>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Change decision"
                                    title="Change decision"
                                    onClick={() => {
                                      setOpenDecisionRowId(app._id);
                                      setDecisionDraft(finalDecision);
                                      setDecisionReasonDraft(app.rejectionReason || '');
                                    }}
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-slate-100"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                {finalDecisionReason && (
                                  <span className="text-[11px] text-muted-foreground truncate max-w-[140px]" title={finalDecisionReason}>
                                    {finalDecisionReason}
                                  </span>
                                )}
                              </div>
                            ) : openDecisionRowId === app._id ? (
                              <div className="flex flex-col gap-1.5 py-1 min-w-[140px]">
                                <Select value={decisionDraft} onValueChange={setDecisionDraft}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="hired">Hired</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
                                    <SelectItem value="withdrawn">Withdrawn</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input
                                  value={decisionReasonDraft}
                                  onChange={(e) => setDecisionReasonDraft(e.target.value)}
                                  placeholder={decisionDraft === 'rejected' ? 'Reason (required)...' : 'Reason (optional)...'}
                                  className="h-7 text-xs"
                                />
                                <div className="flex items-center gap-1 mt-0.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => handleConfirmDecision(app._id)}
                                    disabled={submittingDecision}
                                    className="h-6 px-2 text-[11px] bg-brand text-white hover:bg-brand/90"
                                  >
                                    {submittingDecision ? 'Saving…' : 'Confirm'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setOpenDecisionRowId(null)}
                                    disabled={submittingDecision}
                                    className="h-6 px-2 text-[11px]"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setOpenDecisionRowId(app._id);
                                  setDecisionDraft('hired');
                                  setDecisionReasonDraft('');
                                }}
                                className="h-7 text-xs border-brand/40 text-brand hover:bg-brand/5"
                              >
                                Record Decision
                              </Button>
                            )}
                          </TableCell>

                          <TableCell className="text-right align-middle">
                            <div className="flex items-center justify-end gap-1.5">
                              {finalDecision === 'hired' && (
                                <>
                                  <div className="relative inline-flex">
                                  {app.offerLetterDeliveryStatus === 'sent' && (
                                    <Badge
                                      variant="secondary"
                                      className="absolute top-0 left-1/2 z-10 h-4 -translate-x-1/2 -translate-y-1/3 whitespace-nowrap bg-emerald-100 px-1.5 text-[9px] font-medium leading-none text-emerald-800 hover:bg-emerald-100"
                                      title={`Offer letter emailed${app.offerLetterSentAt ? ` on ${new Date(app.offerLetterSentAt).toLocaleString()}` : ''}.`}
                                    >
                                      Sent
                                    </Badge>
                                  )}
                                  <span
                                    className="inline-flex"
                                    title={`Send an offer letter to ${app.candidateId?.name || 'this candidate'}.`}
                                  >
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      aria-label="Send offer letter"
                                      className="h-8 w-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                      onClick={() => {
                                        setOfferFor(app);
                                      }}
                                    >
                                      <FileText className="h-4 w-4" />
                                    </Button>
                                  </span>
                                </div>
                                <div className="relative inline-flex">
                                  {app.onboardingFormDeliveryStatus === 'sent' && (
                                    <Badge
                                      variant="secondary"
                                      className="absolute top-0 left-1/2 z-10 h-4 -translate-x-1/2 -translate-y-1/3 whitespace-nowrap bg-sky-100 px-1.5 text-[9px] font-medium leading-none text-sky-800 hover:bg-sky-100"
                                      title={`Onboarding form emailed${app.onboardingFormSentAt ? ` on ${new Date(app.onboardingFormSentAt).toLocaleString()}` : ''}.`}
                                    >
                                      Sent
                                    </Badge>
                                  )}
                                  <span
                                    className="inline-flex"
                                    title={`Send ClickUp Onboarding Form to ${app.candidateId?.name || 'this candidate'}.`}
                                  >
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      aria-label="Send ClickUp onboarding form"
                                      className="h-8 w-8 border-sky-200 text-sky-700 hover:bg-sky-50 hover:text-sky-800"
                                      onClick={() => setOnboardingCandidate({
                                        applicationId: app._id,
                                        name: app.candidateId?.name || app.candidateName || 'Candidate',
                                        email: app.candidateId?.email || app.candidateEmail || '',
                                        requisitionTitle: data?.requisition?.title || 'Job opening',
                                      })}
                                    >
                                      <ClipboardList className="h-4 w-4" />
                                    </Button>
                                  </span>
                                </div>
                              </>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                title={goingToInterview === app._id ? 'Opening interview…' : 'Go to Interview'}
                                className="h-8 w-8 border-brand/40 text-brand hover:bg-brand/10 hover:text-brand"
                                onClick={() => handleGoToInterview(app)}
                                disabled={isGoDisabled}
                              >
                                <Play className="h-4 w-4 fill-current" />
                              </Button>
                              {canDelete && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  title="Remove candidate from job opening"
                                  className="h-8 w-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                  onClick={() => setRemoveCandidateApp(app)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
          )}
              {!loading && pagination.total > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                  <p className="text-xs text-muted-foreground">
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
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => load(Math.max(1, pagination.page - 1))}
                        disabled={fetchingCandidates || pagination.page <= 1}
                        className="h-8 text-xs"
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => load(Math.min(pagination.totalPages, pagination.page + 1))}
                        disabled={fetchingCandidates || pagination.page >= pagination.totalPages}
                        className="h-8 text-xs"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
        </CardContent>
      </Card>
      )}

      {/* ---------- scorecard ---------- */}
          {activeTab === 'scorecard' && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Scorecard</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingScorecard ? (
                  <div className="space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-32 w-full" /></div>
                ) : scorecard ? (
                  <ScorecardEditor
                    scorecard={scorecard}
                    stageLabels={stageLabels}
                    onSave={handleSaveScorecard}
                    saving={savingScorecard}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No scorecard generated yet.</p>
                )}
              </CardContent>
            </Card>
          )}

          <OfferLetterDialog
            application={offerFor}
            jobTitle={data?.requisition?.title}
            onClose={() => setOfferFor(null)}
            onSent={load}
          />

          {/* ---------- close confirmation ---------- */}
          <AlertDialog open={pendingClose} onOpenChange={setPendingClose}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close this job opening?</AlertDialogTitle>
                <AlertDialogDescription>
                  New candidates will no longer be able to apply for this position using the public application link.
                  Existing candidates and their scores will remain available.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={savingStatus}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); setPendingClose(false); applyStatus('closed'); }}
                  disabled={savingStatus}
                  className="bg-brand text-white hover:bg-brand/90"
                >
                  {savingStatus ? 'Closing…' : 'Close job'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={!!removeCandidateApp} onOpenChange={(open) => !open && setRemoveCandidateApp(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {removeCandidateApp?.candidateId?.name || 'candidate'} from this job opening?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes their application, interviews, interview documents, scores, and audit records for this job opening. Their profile and applications to other job openings will remain. Calendar invitations created by this app will be cancelled first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={removingCandidate}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={removingCandidate}
                  onClick={(event) => { event.preventDefault(); handleRemoveCandidate(); }}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {removingCandidate ? 'Removing…' : 'Remove candidate'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {requisition?.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the Job Opening, cancels any active scheduled Google Calendar meeting events, deletes attached applications, scorecard, and files. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deletingRequisition}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deletingRequisition}
                  onClick={(event) => { event.preventDefault(); handleDeleteRequisition(); }}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {deletingRequisition ? 'Deleting…' : 'Delete Job Opening'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <SendOnboardingFormModal
            open={!!onboardingCandidate}
            onOpenChange={(open) => !open && setOnboardingCandidate(null)}
            candidate={onboardingCandidate}
            onSuccess={load}
          />

          <Dialog open={!!viewCandidateFor} onOpenChange={(open) => !open && setViewCandidateFor(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Candidate details</DialogTitle>
                <DialogDescription>Review this candidate’s profile and attachments.</DialogDescription>
              </DialogHeader>

              {viewCandidateFor && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-11 w-11">
                      <AvatarFallback>{initials(viewCandidateFor.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-foreground">{viewCandidateFor.name}</p>
                      {viewCandidateFor.createdAt && (
                        <p className="text-xs text-muted-foreground">Added {formatDate(viewCandidateFor.createdAt)}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-lg border bg-slate-50/60 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Email</p>
                      <button
                        type="button"
                        onClick={() => copyContact(viewCandidateFor.email, 'Email')}
                        className="mt-0.5 break-all text-left font-medium hover:text-brand hover:underline"
                      >
                        {viewCandidateFor.email || '—'}
                      </button>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Phone</p>
                      <button
                        type="button"
                        onClick={() => copyContact(viewCandidateFor.phone, 'Phone number')}
                        className="mt-0.5 text-left font-medium hover:text-brand hover:underline"
                      >
                        {viewCandidateFor.phone || '—'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{viewCandidateFor.notes || 'No notes added.'}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Job opening</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{requisition?.title || 'This job opening'}</p>
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                {viewCandidateFor?.resumeFileUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openStoredFile('resume', viewCandidateFor._id)}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    View résumé
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => {
                    const c = viewCandidateFor;
                    setViewCandidateFor(null);
                    openEditCandidate(c);
                  }}
                  className="bg-brand text-white hover:bg-brand/90"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit candidate
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!editCandidateFor} onOpenChange={(open) => !open && setEditCandidateFor(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Candidate Profile</DialogTitle>
                <DialogDescription>
                  Update candidate contact details, notes, or replace their résumé file.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleEditCandidate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-req-cand-name">Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="edit-req-cand-name"
                      value={editCandidateForm.name}
                      autoFocus
                      onChange={(e) => setEditCandidateForm({ ...editCandidateForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-req-cand-email">Email <span className="text-red-500">*</span></Label>
                    <Input
                      id="edit-req-cand-email"
                      type="email"
                      value={editCandidateForm.email}
                      onChange={(e) => setEditCandidateForm({ ...editCandidateForm, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-req-cand-phone">Phone</Label>
                    <Input
                      id="edit-req-cand-phone"
                      value={editCandidateForm.phone}
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]{11}"
                      maxLength={11}
                      onChange={(e) => setEditCandidateForm({ ...editCandidateForm, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                      placeholder="03001234567"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-req-cand-resume">Replace résumé <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      id="edit-req-cand-resume"
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => setEditCandidateResumeFile(e.target.files?.[0] || null)}
                      className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-brand/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-brand hover:file:bg-brand/5"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-req-cand-notes">Notes</Label>
                  <Textarea
                    id="edit-req-cand-notes"
                    rows={3}
                    value={editCandidateForm.notes}
                    onChange={(e) => setEditCandidateForm({ ...editCandidateForm, notes: e.target.value })}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setEditCandidateFor(null)} disabled={editingCandidate}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editingCandidate} className="bg-brand text-white hover:bg-brand/90">
                    {editingCandidate ? 'Saving…' : 'Save changes'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        );
}
