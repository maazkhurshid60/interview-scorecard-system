import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, ArrowLeft, Search, X, Briefcase, ChevronRight, Check, ChevronsUpDown, Users,
} from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '../utils/formatters';

const PAGE_SIZE = 10;

const STATUS_BADGE = {
  open: 'bg-green-100 text-green-800 hover:bg-green-100',
  on_hold: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  closed: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
};
const STATUS_LABEL = { open: 'Open', on_hold: 'On Hold', closed: 'Closed' };

const EMPTY_FORM = { title: '', jobDescription: '', pipelineTemplateId: '' };

export default function Requisitions() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);

  const [requisitions, setRequisitions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  async function loadRequisitions() {
    setLoading(true);
    try {
      const res = await api.get('/requisitions', { params: statusFilter ? { status: statusFilter } : {} });
      setRequisitions(res.data.requisitions);
      console.log("Requistions payload:", res.data.requisitions[0]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequisitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    api.get('/pipelines').then((res) => setTemplates(res.data.templates));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title || !form.jobDescription || !form.pipelineTemplateId) {
      toast.error('Title, job description, and pipeline template are all required.');
      return;
    }
    setCreating(true);
    try {
      const createRes = await api.post('/requisitions', form);
      const requisition = createRes.data.requisition;
      toast.success('Requisition created. Generating scorecard from the JD…');
      await api.post(`/requisitions/${requisition._id}/generate-scorecard`);
      toast.success('Scorecard generated — review and edit below.');
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      loadRequisitions();
      navigate(`/requisitions/${requisition._id}`);

    } catch (error) {
      console.error('Failed to create requisition:', error);

      toast.error(
        error?.response?.data?.message ||
        'Failed to create requisition. Please try again.'
      );
    } finally {
      setCreating(false);
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => (
    query ? requisitions.filter((r) => (r.title || '').toLowerCase().includes(query)) : requisitions
  ), [requisitions, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectedTemplate = templates.find((t) => t._id === form.pipelineTemplateId);

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Requisitions</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${requisitions.length} ${statusFilter ? STATUS_LABEL[statusFilter].toLowerCase() : 'total'}`}
            </p>
          </div>
        </div>
        <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
          <Plus />
          New Requisition
        </Button>
      </div>

      {/* ---------- toolbar ---------- */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by title…"
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
        <Select
          value={statusFilter || 'all'}
          onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ---------- list ---------- */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-56" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : requisitions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {statusFilter ? `No ${STATUS_LABEL[statusFilter].toLowerCase()} requisitions` : 'No requisitions yet'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter
                    ? 'Try a different status filter.'
                    : 'Paste a job description and Claude will draft the scorecard for you.'}
                </p>
              </div>
              {!statusFilter && (
                <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  New Requisition
                </Button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">No matches for “{search}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different title.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requisition</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Candidates</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((r) => {
                  const stats = r.candidateStats || { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 };
                  const enabledStages = (r.stages || []).filter((s) => s.enabled).length;
                  return (
                    <TableRow
                      key={r._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/requisitions/${r._id}`)}
                    >
                      <TableCell>
                        <div className="text-sm font-medium text-foreground">{r.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {enabledStages} stage{enabledStages === 1 ? '' : 's'}
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="secondary" className={`font-normal ${STATUS_BADGE[r.status] || ''}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {stats.total === 0 ? (
                          <span className="text-xs text-muted-foreground">None yet</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              {stats.total}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {stats.inProgress > 0 ? `${stats.inProgress} in progress` : 'all decided'}
                              {stats.HIRE > 0 ? ` · ${stats.HIRE} hire` : ''}
                            </span>
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {r?.pipelineTemplateName}
                      </TableCell>

                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                        {formatDate(r.createdAt)}
                      </TableCell>

                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New requisition</DialogTitle>
            <DialogDescription>
              Claude reads the job description to draft stage questions and scoring criteria — the more detail, the better the scorecard.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Title</Label>
              <Input
                id="req-title" value={form.title} autoFocus
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Sales Executive / Closer"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="req-jd">Job description</Label>
              <Textarea
                id="req-jd" rows={9} value={form.jobDescription}
                onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
                placeholder="Paste the full job description here…"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="req-template">Pipeline template</Label>
              <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="req-template" type="button" variant="outline" role="combobox"
                    aria-expanded={templatePickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className={selectedTemplate ? '' : 'text-muted-foreground'}>
                      {selectedTemplate
                        ? `${selectedTemplate.name}${selectedTemplate.isDefault ? ' (default)' : ''}`
                        : 'Choose a pipeline…'}
                    </span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to filter…" />
                    <CommandList>
                      <CommandEmpty>No pipeline matches.</CommandEmpty>
                      <CommandGroup>
                        {templates.map((t) => {
                          const stageCount = (t.stages || []).filter((s) => s.enabled).length;
                          return (
                            <CommandItem
                              key={t._id}
                              value={t.name}
                              onSelect={() => {
                                setForm((f) => ({ ...f, pipelineTemplateId: t._id }));
                                setTemplatePickerOpen(false);
                              }}
                            >
                              <Check className={form.pipelineTemplateId === t._id ? 'opacity-100' : 'opacity-0'} />
                              <span className="flex-1">{t.name}{t.isDefault ? ' (default)' : ''}</span>
                              <span className="text-xs text-muted-foreground">{stageCount} stages</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedTemplate && (
                <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90">
                {creating ? 'Creating & generating…' : 'Create & generate scorecard'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
