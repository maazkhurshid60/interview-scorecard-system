import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, ArrowLeft, Search, X, MoreHorizontal, FileText, Copy, Link2, Users, Check, ChevronsUpDown,
} from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { formatDate, formatDisposition } from '../utils/formatters';

const PAGE_SIZE = 10;

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

export default function Candidates() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);

  const [candidates, setCandidates] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resumeFile, setResumeFile] = useState(null);
  const [creating, setCreating] = useState(false);

  const [attachFor, setAttachFor] = useState(null); // the candidate being attached
  const [attachTarget, setAttachTarget] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [reqPickerOpen, setReqPickerOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  async function loadCandidates() {
    setLoading(true);
    try {
      const res = await api.get('/candidates');
      setCandidates(res.data.candidates);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCandidates();
    api.get('/requisitions', { params: { status: 'open' } }).then((res) => setRequisitions(res.data.requisitions));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required.');
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
    } finally {
      setCreating(false);
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
        toast.error(res.data?.message || 'Already attached to this requisition.');
      } else {
        toast.error(res.data?.message || 'Could not attach candidate.');
      }
    } finally {
      setAttaching(false);
    }
  }

  function copyEmail(candidate) {
    if (!candidate.email) return;
    navigator.clipboard.writeText(candidate.email)
      .then(() => toast.success('Email copied.'))
      .catch(() => toast.error('Could not copy the email.'));
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => (
    query
      ? candidates.filter((c) => `${c.name || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(query))
      : candidates
  ), [candidates, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Requisitions this candidate isn't on yet — attaching twice is a guaranteed 409.
  const availableRequisitions = attachFor
    ? requisitions.filter((r) => !(attachFor.applications || []).some((a) => a.requisitionId === r._id))
    : [];

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Candidates</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${candidates.length} total`}
            </p>
          </div>
        </div>
        <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
          <Plus />
          New Candidate
        </Button>
      </div>

      {/* ---------- search ---------- */}
      {(candidates.length > 0 || loading) && (
        <div className="relative mt-5 w-full sm:max-w-sm">
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
      )}

      {/* ---------- list ---------- */}
      <Card className="mt-4">
        <CardContent className="p-0">
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
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No candidates yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add someone, then attach them to a requisition to start interviewing.
                </p>
              </div>
              <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
                <Plus />
                New Candidate
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">No matches for “{search}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different name, email or phone number.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead>Attached to</TableHead>
                  <TableHead className="hidden lg:table-cell">Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initials(c.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{c.email || '—'}</div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">
                      {c.phone || '—'}
                    </TableCell>

                    <TableCell>
                      {(c.applications || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">Not attached</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {c.applications.map((a) => (
                            <Link key={a.applicationId} to={`/requisitions/${a.requisitionId}`}>
                              <Badge
                                variant="secondary"
                                className={`font-normal ${a.disposition ? DISPOSITION_BADGE[a.disposition] || '' : ''}`}
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
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline" size="sm"
                          className="border-[#d21e2b]/40 text-[#d21e2b] hover:bg-[#d21e2b]/5 hover:text-[#d21e2b]"
                          onClick={() => openAttach(c)}
                        >
                          <Link2 />
                          Attach
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal />
                              <span className="sr-only">More actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!c.resumeFileUrl}
                              onClick={() => window.open(c.resumeFileUrl, '_blank', 'noreferrer')}
                            >
                              <FileText />
                              {c.resumeFileUrl ? 'View résumé' : 'No résumé'}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!c.email} onClick={() => copyEmail(c)}>
                              <Copy />
                              Copy email
                            </DropdownMenuItem>
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
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</span>
            <Button
              variant="outline" size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ---------- create dialog ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New candidate</DialogTitle>
            <DialogDescription>
              Only a name is required — everything else can be added later.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cand-name">Name</Label>
                <Input
                  id="cand-name" value={form.name} autoFocus
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Cooper"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-email">Email</Label>
                <Input
                  id="cand-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-phone">Phone</Label>
                <Input
                  id="cand-phone" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0300-1234567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-resume">Résumé <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="cand-resume" type="file"
                  onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                  className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-[#d21e2b]/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-[#d21e2b] hover:file:bg-[#d21e2b]/5"
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
              <Button type="submit" disabled={creating} className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90">
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
            <DialogTitle>Attach to a requisition</DialogTitle>
            <DialogDescription>
              {attachFor ? `${attachFor.name} will start at the first stage of the pipeline.` : ''}
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
                ? 'No open requisitions yet — create one first.'
                : 'This candidate is already attached to every open requisition.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="attach-req">Requisition</Label>
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
                        : `Search ${availableRequisitions.length} open requisition${availableRequisitions.length === 1 ? '' : 's'}…`}
                    </span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to filter…" />
                    <CommandList>
                      <CommandEmpty>No requisition matches.</CommandEmpty>
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
              className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
            >
              {attaching ? 'Attaching…' : 'Attach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
