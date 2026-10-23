import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, Search, X, MoreHorizontal, FileText, Copy, Briefcase, Users, Check, ChevronsUpDown, Trash2, Upload, Pencil,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { canDeleteRecords, canManageCandidates } from '../lib/permissions';
import api from '../hooks/useApi';
import { candidatesListOptions, requisitionsListOptions } from '../hooks/queries';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { formatDate, formatDisposition } from '../utils/formatters';
import { openStoredFile } from '../lib/fileAccess';
import { validatePdfFile } from '../lib/fileRules';

const PER_PAGE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const PER_PAGE_STORAGE_KEY = 'candidates_per_page';

function getStoredPageSize() {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  try {
    const saved = localStorage.getItem(PER_PAGE_STORAGE_KEY);
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

const DISPOSITION_BADGE = {
  HIRE: 'bg-green-100 text-green-800 hover:bg-green-100',
  MAYBE: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  NO_HIRE: 'bg-red-100 text-red-800 hover:bg-red-100',
};

/** "Mehwish Tariq" -> "MT"; falls back to the first character for single-word names. */
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const EMPTY_FORM = { name: '', email: '', phone: '', notes: '' };
const PHONE_NUMBER_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export default function Candidates() {
  const { user } = useAuth();
  const canDelete = canDeleteRecords(user); // only owners and admins may delete candidates
  const canManage = canManageCandidates(user); // owner, admin, hiring manager, recruiter

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resumeFile, setResumeFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [viewFor, setViewFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editResumeFile, setEditResumeFile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState([]);
  const [importing, setImporting] = useState(false);

  const [attachFor, setAttachFor] = useState(null); // the candidate being attached
  const [attachTarget, setAttachTarget] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [reqPickerOpen, setReqPickerOpen] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [bulkAttachOpen, setBulkAttachOpen] = useState(false);
  const [bulkAttachTarget, setBulkAttachTarget] = useState('');
  const [bulkAttaching, setBulkAttaching] = useState(false);
  const [bulkReqPickerOpen, setBulkReqPickerOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [requisitionFilter, setRequisitionFilter] = useState('all');
  const [dateSort, setDateSort] = useState('newest');
  const [pageSize, setPageSize] = useState(() => getStoredPageSize());
  const [page, setPage] = useState(1);

  // The list comes from the app-wide data cache (see lib/queryClient.js). A page that was loaded a moment ago
  // (for example going back from page 2 to page 1) is shown without asking the API again. Any change made
  // through the API client marks it out of date, and because it is on screen it is re-read at once.
  const listParams = {
    page,
    limit: pageSize,
    search: debouncedSearch.trim() || undefined,
    requisitionId: requisitionFilter !== 'all' ? requisitionFilter : undefined,
    sort: dateSort,
  };
  const listQuery = useQuery(candidatesListOptions(listParams));
  const candidates = listQuery.data?.candidates ?? [];
  const filterRequisitions = listQuery.data?.requisitionOptions ?? [];
  const pagination = listQuery.data?.pagination ?? { total: 0, page: 1, limit: pageSize, totalPages: 1 };
  const loading = listQuery.isPending; // only the very first load; later pages keep the current one on screen
  // True only while a page that is not in the cache yet is loading (the pager buttons wait for it).
  // A quiet refresh of a page that is already on screen does not lock them.
  const fetchingCandidates = listQuery.isPlaceholderData;
  const requisitions = useQuery(requisitionsListOptions('open')).data?.requisitions ?? [];

  // The server corrects an out-of-range page (for example after deleting the last candidate on the last page).
  useEffect(() => {
    const serverPage = listQuery.data?.pagination?.page;
    if (!listQuery.isPlaceholderData && serverPage && serverPage !== page) setPage(serverPage);
  }, [listQuery.data, listQuery.isPlaceholderData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept as a function because the page, the pager buttons and every save/delete handler call it.
  // Showing a page is just choosing it; the cache fetches it only when it does not have it.
  function loadCandidates(targetPage = page, targetLimit = pageSize) {
    if (targetLimit !== pageSize) setPageSize(targetLimit);
    setPage(targetPage);
  }

  function handlePageSizeChange(val) {
    const nextSize = Number(val);
    if (!PER_PAGE_OPTIONS.includes(nextSize)) return;
    setStoredPageSize(nextSize);
    setPageSize(nextSize);
    setPage(1);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    loadCandidates(1);
  }, [debouncedSearch, requisitionFilter, dateSort]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!form.email.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(form.email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    const duplicate = candidates.some((c) => c.email?.trim().toLowerCase() === form.email.trim().toLowerCase());
    if (duplicate) {
      toast.error('A candidate with this email address already exists.');
      return;
    }
    if (form.phone && !PHONE_NUMBER_PATTERN.test(form.phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }
    setCreating(true);
    try {
      const body = new FormData();
      body.append('name', form.name);
      if (form.email) body.append('email', form.email);
      if (form.phone) body.append('phone', form.phone);
      if (form.notes) body.append('notes', form.notes);
      if (resumeFile) body.append('resume', resumeFile);

      await api.post('/candidates', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${form.name.trim()} added.`);
      setForm(EMPTY_FORM);
      setResumeFile(null);
      setCreateOpen(false);
      loadCandidates();
    } catch {
      // API interceptor handles toast error messaging
    } finally {
      setCreating(false);
    }
  }

  function openEdit(candidate) {
    setViewFor(null);
    setEditFor(candidate);
    setEditForm({
      name: candidate.name || '', email: candidate.email || '', phone: candidate.phone || '', notes: candidate.notes || '',
    });
    setEditResumeFile(null);
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editFor) return;
    if (!editForm.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!editForm.email.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(editForm.email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    const duplicate = candidates.some((c) => c._id !== editFor._id && c.email?.trim().toLowerCase() === editForm.email.trim().toLowerCase());
    if (duplicate) {
      toast.error('A candidate with this email address already exists.');
      return;
    }
    if (editForm.phone && !PHONE_NUMBER_PATTERN.test(editForm.phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }

    setEditing(true);
    try {
      const body = new FormData();
      body.append('name', editForm.name.trim());
      body.append('email', editForm.email.trim());
      body.append('phone', editForm.phone.trim());
      body.append('notes', editForm.notes);
      if (editResumeFile) body.append('resume', editResumeFile);
      await api.patch(`/candidates/${editFor._id}`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${editForm.name.trim()}'s profile was updated.`);
      setEditFor(null);
      setEditResumeFile(null);
      loadCandidates();
    } catch {
      // API interceptor handles toast error messaging
    } finally {
      setEditing(false);
    }
  }

  function openAttach(candidate) {
    setAttachFor(candidate);
    setAttachTarget('');
    setReqPickerOpen(false);
  }

  async function handleAttach() {
    if (!attachTarget) {
      toast.error('Pick a requisition first.');
      return;
    }
    setAttaching(true);
    try {
      const res = await api.post(
        `/candidates/${attachFor._id}/apply`,
        { requisitionId: attachTarget },
        { validateStatus: () => true }
      );
      if (res.status === 201) {
        const title = requisitions.find((r) => r._id === attachTarget)?.title || 'requisition';
        toast.success(`${attachFor.name} attached to ${title}.`);
        setAttachFor(null);
        loadCandidates(); // reflect the new badge without a manual refresh
      } else if (res.status === 409) {
        toast.error(res.data?.message || 'Already attached to this Job Opening.');
      } else {
        toast.error(res.data?.message || 'Could not attach candidate.');
      }
    } finally {
      setAttaching(false);
    }
  }

  function toggleSelectCandidate(id, event) {
    if (event) event.stopPropagation();
    setSelectedCandidateIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  function toggleSelectAllOnPage() {
    const pageIds = candidates.map((c) => c._id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedCandidateIds.includes(id));
    if (allSelected) {
      setSelectedCandidateIds((current) => current.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedCandidateIds((current) => Array.from(new Set([...current, ...pageIds])));
    }
  }

  async function handleBulkAttach() {
    if (!bulkAttachTarget) {
      toast.error('Pick a job opening first.');
      return;
    }
    setBulkAttaching(true);
    try {
      const res = await api.post('/candidates/bulk-attach', {
        candidateIds: selectedCandidateIds,
        requisitionId: bulkAttachTarget,
      });
      toast.success(res.data?.message || 'Candidates attached successfully.');
      setBulkAttachOpen(false);
      setSelectedCandidateIds([]);
      setBulkAttachTarget('');
      loadCandidates();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not attach candidates.');
    } finally {
      setBulkAttaching(false);
    }
  }

  function downloadBulkTemplate() {
    const blob = new Blob(['name,email,phone,notes\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'candidate-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleBulkFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a CSV file.');
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) {
        toast.error('The CSV must include a header row and at least one candidate.');
        return;
      }
      const headers = parsed[0].map((header) => {
        const h = header.replace(/^\uFEFF/, '').trim().toLowerCase();
        if (['full name', 'candidate name', 'name'].includes(h)) return 'name';
        if (['email address', 'email'].includes(h)) return 'email';
        if (['phone number', 'mobile', 'cell', 'telephone', 'phone'].includes(h)) return 'phone';
        if (['notes', 'comment', 'comments', 'remark', 'remarks'].includes(h)) return 'notes';
        return h;
      });
      const requiredHeaders = ['name', 'email'];
      const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
      if (missingHeaders.length > 0) {
        toast.error(`Missing CSV column${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}.`);
        return;
      }

      const existingEmails = new Set(candidates.map((candidate) => candidate.email?.trim().toLowerCase()).filter(Boolean));
      const fileEmails = new Set();
      const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]));
      const rows = parsed.slice(1).map((cells, index) => {
        const candidate = {
          rowNumber: index + 2,
          name: (cells[headerIndex.name] || '').trim(),
          email: (cells[headerIndex.email] || '').trim(),
          phone: (cells[headerIndex.phone] || '').trim(),
          notes: (cells[headerIndex.notes] || '').trim(),
        };
        const errors = [];
        if (!candidate.name) errors.push('Name is required');
        if (!candidate.email) errors.push('Email is required');
        else if (!EMAIL_PATTERN.test(candidate.email)) errors.push('Invalid email');
        if (candidate.phone && !PHONE_NUMBER_PATTERN.test(candidate.phone)) errors.push('Phone must be exactly 11 digits');
        const emailKey = candidate.email.toLowerCase();
        if (emailKey && existingEmails.has(emailKey)) errors.push('Email already exists');
        if (emailKey && fileEmails.has(emailKey)) errors.push('Duplicate email in file');
        if (emailKey) fileEmails.add(emailKey);
        return { ...candidate, errors };
      });
      setBulkRows(rows);
    } catch (error) {
      console.error('[Candidates] CSV parsing failed:', error);
      toast.error('Could not read this CSV file.');
    }
  }

  async function handleBulkImport() {
    const validRows = bulkRows.filter((row) => row.errors.length === 0);
    if (validRows.length === 0) {
      toast.error('Fix the CSV errors before importing.');
      return;
    }
    setImporting(true);
    try {
      const res = await api.post('/candidates/bulk', { candidates: validRows });
      const { createdCount, skippedCount } = res.data;
      toast.success(`${createdCount} candidate${createdCount === 1 ? '' : 's'} imported.${skippedCount ? ` ${skippedCount} skipped.` : ''}`);
      setBulkRows([]);
      setBulkImportOpen(false);
      loadCandidates();
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      await api.delete(`/candidates/${deleteFor._id}`);
      toast.success(`${deleteFor.name} and all related records were deleted.`);
      setDeleteFor(null);
      loadCandidates();
    } finally {
      setDeleting(false);
    }
  }

  function copyContact(value, label) {
    if (!value) return;
    navigator.clipboard.writeText(value)
      .then(() => toast.success(`${label} copied.`))
      .catch(() => toast.error(`Could not copy the ${label.toLowerCase()}.`));
  }

  // Requisitions this candidate isn't on yet — attaching twice is a guaranteed 409.
  const availableRequisitions = attachFor
    ? requisitions.filter((r) => !(attachFor.applications || []).some((a) => a.requisitionId === r._id))
    : [];

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <Users className="h-7 w-7 text-brand" />
              Candidates
            </h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${pagination.total} ${search || requisitionFilter !== 'all' ? 'matching' : 'total'}`}
            </p>
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
              <Upload />
              Import CSV
            </Button>
            <Button className="bg-brand text-white hover:bg-brand/90" onClick={() => setCreateOpen(true)}>
              <Plus />
              New Candidate
            </Button>
          </div>
        )}
      </div>

      {/* ---------- search ---------- */}
      {(pagination.total > 0 || loading || search || requisitionFilter !== 'all') && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name, email or phone…"
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

          <Select value={requisitionFilter} onValueChange={(value) => { setRequisitionFilter(value); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="All Job Openings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Job Openings</SelectItem>
              {filterRequisitions.map((requisition) => (
                <SelectItem key={requisition.id} value={requisition.id}>{requisition.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateSort} onValueChange={(value) => { setDateSort(value); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Sort by date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ---------- list ---------- */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {canManage && selectedCandidateIds.length > 0 && (
            <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                  {selectedCandidateIds.length}
                </span>
                <span>candidate{selectedCandidateIds.length === 1 ? '' : 's'} selected</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="bg-brand text-white hover:bg-brand/90 gap-1.5"
                  onClick={() => { setBulkAttachTarget(''); setBulkReqPickerOpen(false); setBulkAttachOpen(true); }}
                >
                  <Briefcase className="h-4 w-4" />
                  Attach to Job Opening
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : pagination.total === 0 && !search && requisitionFilter === 'all' ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No candidates yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add someone, then attach them to a job opening to start interviewing.
                </p>
              </div>
              <Button className="bg-brand text-white hover:bg-brand/90" onClick={() => setCreateOpen(true)}>
                <Plus />
                New Candidate
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">
                {search ? `No matches for “${search}”` : 'No matching candidates'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try adjusting your search query or job opening filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => { setSearch(''); setRequisitionFilter('all'); setPage(1); }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={candidates.length > 0 && candidates.every((c) => selectedCandidateIds.includes(c._id))}
                      onCheckedChange={toggleSelectAllOnPage}
                      aria-label="Select all candidates on this page"
                    />
                  </TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead>Attached to</TableHead>
                  <TableHead className="hidden lg:table-cell">Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow
                    key={c._id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewFor(c)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setViewFor(c);
                      }
                    }}
                    className="cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    title={`View ${c.name}`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                      <Checkbox
                        checked={selectedCandidateIds.includes(c._id)}
                        onCheckedChange={() => toggleSelectCandidate(c._id)}
                        aria-label={`Select ${c.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex items-center gap-3"
                      >
                        <Avatar className="h-8 w-8 text-xs">
                          <AvatarFallback>{initials(c.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                          {c.email ? (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); copyContact(c.email, 'Email'); }}
                              className="block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
                              title="Copy email"
                            >
                              {c.email}
                            </button>
                          ) : (
                            <div className="text-xs text-muted-foreground">—</div>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">
                      {c.phone ? (
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); copyContact(c.phone, 'Phone number'); }}
                          className="hover:text-foreground hover:underline"
                          title="Copy phone number"
                        >
                          {c.phone}
                        </button>
                      ) : '—'}
                    </TableCell>

                    <TableCell>
                      {(c.applications || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">Not attached</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {c.applications.map((a) => (
                            <Link key={a.applicationId} to={`/requisitions/${a.requisitionId}`} onClick={(event) => event.stopPropagation()}>
                              <Badge
                                variant="secondary"
                                className={`text-[11px] py-0.5 px-2 font-normal ${a.disposition ? DISPOSITION_BADGE[a.disposition] || '' : ''}`}
                                title={a.disposition ? formatDisposition(a.disposition) : 'In progress'}
                              >
                                {a.title}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                      {formatDate(c.createdAt)}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                        {canManage && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-brand/40 text-brand hover:bg-brand/5 hover:text-brand"
                            title="Attach to Job Opening"
                            aria-label="Attach to Job Opening"
                            onClick={() => openAttach(c)}
                          >
                            <Briefcase className="h-4 w-4" />
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal />
                              <span className="sr-only">More actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!c.resumeFileUrl}
                              onClick={() => openStoredFile('resume', c._id)}
                            >
                              <FileText />
                              {c.resumeFileUrl ? 'View résumé' : 'No résumé'}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!c.email} onClick={() => copyContact(c.email, 'Email')}>
                              <Copy />
                              Copy email
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!c.phone} onClick={() => copyContact(c.phone, 'Phone number')}>
                              <Copy />
                              Copy phone
                            </DropdownMenuItem>
                            {canManage && (
                              <DropdownMenuItem onClick={() => openEdit(c)}>
                                <Pencil />
                                Edit candidate
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <DropdownMenuItem onClick={() => setDeleteFor(c)} className="text-red-600 focus:text-red-600">
                                <Trash2 />
                                Delete candidate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---------- pagination ---------- */}
      {!loading && pagination.total > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
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
                onClick={() => loadCandidates(pagination.page - 1)}
                disabled={fetchingCandidates || pagination.page <= 1}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} of {Math.max(1, pagination.totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadCandidates(pagination.page + 1)}
                disabled={fetchingCandidates || pagination.page >= pagination.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the candidate, all of their applications, interviews, scores, audit entries, and uploaded files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => { event.preventDefault(); handleDelete(); }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? 'Deleting…' : 'Delete candidate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editFor} onOpenChange={(open) => !open && setEditFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit candidate</DialogTitle>
            <DialogDescription>
              Update the candidate profile. Replacing the profile résumé does not change résumé evidence already attached to interviews.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cand-name">Name <span className="text-red-500">*</span></Label>
                <Input id="edit-cand-name" value={editForm.name} autoFocus onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cand-email">Email <span className="text-red-500">*</span></Label>
                <Input id="edit-cand-email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cand-phone">Phone</Label>
                <Input id="edit-cand-phone" value={editForm.phone} type="tel" inputMode="numeric" pattern="[0-9]{11}" maxLength={11} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })} placeholder="03001234567" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cand-resume">Replace résumé <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="edit-cand-resume" type="file" accept="application/pdf,.pdf" onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  const problem = validatePdfFile(file, 'résumé');
                  if (problem) { toast.error(problem); e.target.value = ''; setEditResumeFile(null); return; }
                  setEditResumeFile(file);
                }} className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-brand/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-brand hover:file:bg-brand/5" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-cand-notes">Notes</Label>
              <Textarea id="edit-cand-notes" rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditFor(null)} disabled={editing}>Cancel</Button>
              <Button type="submit" disabled={editing} className="bg-brand text-white hover:bg-brand/90">
                {editing ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- bulk attach dialog ---------- */}
      <Dialog open={bulkAttachOpen} onOpenChange={(open) => !open && setBulkAttachOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach {selectedCandidateIds.length} candidate{selectedCandidateIds.length === 1 ? '' : 's'}</DialogTitle>
            <DialogDescription>
              Select a job opening to attach all selected candidates at once. Candidates already attached to this job opening will be safely skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Target Job Opening <span className="text-red-500">*</span></Label>
              <Popover open={bulkReqPickerOpen} onOpenChange={setBulkReqPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={bulkReqPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {bulkAttachTarget
                        ? requisitions.find((r) => r._id === bulkAttachTarget)?.title || 'Select job opening...'
                        : 'Select job opening...'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search job openings..." />
                    <CommandList>
                      <CommandEmpty>No active job opening found.</CommandEmpty>
                      <CommandGroup>
                        {requisitions.map((req) => (
                          <CommandItem
                            key={req._id}
                            value={`${req.title} ${req._id}`}
                            onSelect={() => {
                              setBulkAttachTarget(req._id);
                              setBulkReqPickerOpen(false);
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${bulkAttachTarget === req._id ? 'opacity-100' : 'opacity-0'}`}
                            />
                            <span className="flex-1 truncate">{req.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkAttachOpen(false)} disabled={bulkAttaching}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={bulkAttaching || !bulkAttachTarget}
              onClick={handleBulkAttach}
              className="bg-brand text-white hover:bg-brand/90 gap-1.5"
            >
              <Briefcase className="h-4 w-4" />
              {bulkAttaching ? 'Attaching…' : `Attach ${selectedCandidateIds.length} Candidates`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewFor} onOpenChange={(open) => !open && setViewFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Candidate details</DialogTitle>
            <DialogDescription>Review this candidate’s profile and attachments.</DialogDescription>
          </DialogHeader>

          {viewFor && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  <AvatarFallback>{initials(viewFor.name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-foreground">{viewFor.name}</p>
                  <p className="text-xs text-muted-foreground">Added {formatDate(viewFor.createdAt)}</p>
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border bg-slate-50/60 p-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Email</p>
                  <button type="button" onClick={() => copyContact(viewFor.email, 'Email')} className="mt-0.5 break-all text-left font-medium hover:text-brand hover:underline">
                    {viewFor.email || '—'}
                  </button>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Phone</p>
                  <button type="button" onClick={() => copyContact(viewFor.phone, 'Phone number')} className="mt-0.5 text-left font-medium hover:text-brand hover:underline">
                    {viewFor.phone || '—'}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{viewFor.notes || 'No notes added.'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">Attached to</p>
                {(viewFor.applications || []).length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {viewFor.applications.map((application) => (
                      <Badge key={application.applicationId} variant="secondary" className="text-[11px] py-0.5 px-2 font-normal">
                        {application.title}
                      </Badge>
                    ))}
                  </div>
                ) : <p className="mt-1 text-sm">Not attached to a job opening.</p>}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {viewFor?.resumeFileUrl && (
              <Button type="button" variant="outline" onClick={() => openStoredFile('resume', viewFor._id)}>
                <FileText />
                View résumé
              </Button>
            )}
            <Button type="button" onClick={() => openEdit(viewFor)} className="bg-brand text-white hover:bg-brand/90">
              <Pencil />
              Edit candidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- bulk import dialog ---------- */}
      <Dialog open={bulkImportOpen} onOpenChange={(open) => {
        setBulkImportOpen(open);
        if (!open) setBulkRows([]);
      }}>
        <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Import candidates from CSV</DialogTitle>
            <DialogDescription>
              Your CSV should contain the columns <b>name</b>, <b>email</b>, <b>phone</b> and <b>notes</b>.
              Name and email are required. Phone and notes are optional, must be valid if provided.
            </DialogDescription>
          </DialogHeader>

          {/* CSV upload */}
          <div className="shrink-0 flex flex-wrap items-center gap-3">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => handleBulkFile(event.target.files?.[0])}
              className="max-w-sm cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-brand/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-brand hover:file:bg-brand/5"
            />

            <Button
              type="button"
              variant="link"
              className="px-0 text-brand underline underline-offset-4 hover:text-brand-dark"
              onClick={downloadBulkTemplate}
            >
              Download CSV Template
            </Button>
          </div>

          {/* Preview */}
          {bulkRows.length > 0 && (() => {
            const validCount = bulkRows.filter(
              (row) => row.errors.length === 0
            ).length;

            const invalidCount = bulkRows.length - validCount;

            return (
              <div className="flex flex-1 flex-col min-h-0 space-y-3">
                {/* Summary */}
                <p className="shrink-0 text-sm text-muted-foreground">
                  {validCount} ready to import
                  {invalidCount
                    ? ` · ${invalidCount} row${invalidCount === 1 ? '' : 's'} need attention`
                    : ''}
                </p>

                {/* ONLY THE TABLE SCROLLS */}
                <div className="flex-1 min-h-0 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {bulkRows.map((row) => (
                        <TableRow
                          key={row.rowNumber}
                          className={
                            row.errors.length > 0
                              ? 'bg-red-50/60'
                              : ''
                          }
                        >
                          <TableCell>{row.rowNumber}</TableCell>

                          <TableCell>
                            {row.name || '—'}
                          </TableCell>

                          <TableCell>
                            {row.email || '—'}
                          </TableCell>

                          <TableCell>
                            {row.phone || '—'}
                          </TableCell>

                          <TableCell
                            className="max-w-[10rem] truncate"
                            title={row.notes}
                          >
                            {row.notes || '—'}
                          </TableCell>

                          <TableCell
                            className={
                              row.errors.length > 0
                                ? 'text-red-600'
                                : 'text-green-700'
                            }
                          >
                            {row.errors.length > 0
                              ? row.errors.join(', ')
                              : 'Ready'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })()}

          {/* Buttons */}
          <DialogFooter className="shrink-0 border-t pt-4 mt-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkImportOpen(false)}
              disabled={importing}
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={handleBulkImport}
              disabled={
                importing ||
                bulkRows.filter((row) => row.errors.length === 0).length === 0
              }
              className="bg-brand text-white hover:bg-brand/90"
            >
              {importing
                ? 'Importing…'
                : `Import ${bulkRows.filter((row) => row.errors.length === 0).length || ''
                } candidate${bulkRows.filter((row) => row.errors.length === 0).length === 1
                  ? ''
                  : 's'
                }`}
            </Button>
          </DialogFooter>
        </DialogContent>

      </Dialog>

      {/* ---------- create dialog ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New candidate</DialogTitle>
            <DialogDescription>
              Name and email are required — everything else can be added later.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cand-name">Name <span className="text-red-500">*</span></Label>
                <Input
                  id="cand-name" value={form.name} autoFocus
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Cooper"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-email">Email <span className="text-red-500">*</span></Label>
                <Input
                  id="cand-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@example.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-phone">Phone</Label>
                <Input
                  id="cand-phone" value={form.phone}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  maxLength={11}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  placeholder="03001234567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-resume">Résumé <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="cand-resume" type="file" accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    const problem = validatePdfFile(file, 'résumé');
                    if (problem) { toast.error(problem); e.target.value = ''; setResumeFile(null); return; }
                    setResumeFile(file);
                  }}
                  className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-brand/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-brand hover:file:bg-brand/5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cand-notes">Notes</Label>
              <Textarea
                id="cand-notes" rows={3} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Source, referral, anything worth remembering…"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="bg-brand text-white hover:bg-brand/90">
                {creating ? 'Creating…' : 'Create candidate'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- attach dialog ---------- */}
      <Dialog open={!!attachFor} onOpenChange={(open) => !open && setAttachFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attach to a job opening</DialogTitle>
            <DialogDescription>
              {attachFor ? `${attachFor.name} will start at the first stage of the hiring process.` : ''}
            </DialogDescription>
          </DialogHeader>

          {(attachFor?.applications || []).length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">Already attached to</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {attachFor.applications.map((a) => (
                  <Badge key={a.applicationId} variant="secondary" className="font-normal">{a.title}</Badge>
                ))}
              </div>
            </div>
          )}

          {availableRequisitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {requisitions.length === 0
                ? 'No open job opening yet — create one first.'
                : 'This candidate is already attached to every job Opening.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="attach-req">Job Openings</Label>
              {/* Searchable rather than a plain Select: a hiring team can easily
                  carry dozens of open roles, and scrolling a flat list to find
                  one is unusable. Capping the list instead would be worse — it
                  would make anything past the cap impossible to attach to. */}
              <Popover open={reqPickerOpen} onOpenChange={setReqPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="attach-req"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={reqPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className={attachTarget ? '' : 'text-muted-foreground'}>
                      {attachTarget
                        ? availableRequisitions.find((r) => r._id === attachTarget)?.title
                        : `Search ${availableRequisitions.length} open job${availableRequisitions.length === 1 ? '' : 's'}…`}
                    </span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to filter…" />
                    <CommandList>
                      <CommandEmpty>No job matches.</CommandEmpty>
                      <CommandGroup>
                        {availableRequisitions.map((r) => (
                          <CommandItem
                            key={r._id}
                            value={r.title}
                            onSelect={() => {
                              setAttachTarget(r._id);
                              setReqPickerOpen(false);
                            }}
                          >
                            <Check className={attachTarget === r._id ? 'opacity-100' : 'opacity-0'} />
                            {r.title}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachFor(null)}>Cancel</Button>
            <Button
              onClick={handleAttach}
              disabled={attaching || !attachTarget || availableRequisitions.length === 0}
              className="bg-brand text-white hover:bg-brand/90"
            >
              {attaching ? 'Attaching…' : 'Attach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
