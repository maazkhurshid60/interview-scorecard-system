import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, ChevronUp, ChevronDown, Star, Trash2, ArrowLeft, Search, X,
  GitBranch, MoreHorizontal,
} from 'lucide-react';
import api from '../hooks/useApi';
import WeightConfig from '../components/WeightConfig';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PAGE_SIZE = 10;

/** Starting point for a brand-new template — every known stage type, all disabled by default. */
const STAGE_TYPE_DEFAULTS = [
  { key: 'resume_screen', label: 'Résumé Screen', stageType: 'resume_screen', inputType: 'artifact' },
  { key: 'hr_screen', label: 'HR Screen', stageType: 'hr_screen', inputType: 'transcript' },
  { key: 'task_performance', label: 'Task Performance', stageType: 'task_performance', inputType: 'artifact' },
  { key: 'technical', label: 'Technical', stageType: 'technical', inputType: 'transcript' },
  { key: 'simulation', label: 'Simulation', stageType: 'simulation', inputType: 'transcript' },
  { key: 'client', label: 'Client Interview', stageType: 'client', inputType: 'transcript' },
  { key: 'culture', label: 'Culture Fit', stageType: 'culture', inputType: 'transcript' },
  { key: 'final', label: 'Final / Executive', stageType: 'final', inputType: 'transcript' },
  { key: 'reference', label: 'Reference Check', stageType: 'reference', inputType: 'transcript' },
  { key: 'background', label: 'Background Check', stageType: 'background', inputType: 'pass_fail' },
  { key: 'offer', label: 'Offer', stageType: 'offer', inputType: 'status_only' },
].map((s, i) => ({ ...s, enabled: false, order: i + 1, weight: 0, passThreshold: 3.0 }));

const INPUT_TYPE_LABEL = {
  transcript: 'Transcript',
  artifact: 'Artifact',
  pass_fail: 'Pass / fail',
  status_only: 'Status only',
};

function reindexOrder(stages) {
  return stages.map((s, i) => ({ ...s, order: i + 1 }));
}

/**
 * Splits the 100% budget evenly across enabled scored stages — one stage gets
 * 100%, two get 50/50, and so on. Mirrors the identical rule the server
 * applies on save (see pipelineController.equalizeScoredWeights), so the
 * percentages update live as checkboxes are toggled instead of only appearing
 * after a round-trip. pass_fail/status_only stages never carry weight.
 */
function equalizeScoredWeights(stages) {
  const scoredKeys = stages
    .filter((s) => s.enabled && s.inputType !== 'pass_fail' && s.inputType !== 'status_only')
    .map((s) => s.key);
  if (scoredKeys.length === 0) return stages;

  const share = 1 / scoredKeys.length;
  return stages.map((s) => (scoredKeys.includes(s.key) ? { ...s, weight: share } : s));
}

/** One template's editable card: toggle/reorder stages, edit weights & gates, save/default/delete. */
function TemplateCard({ template, onChanged, onDeleted }) {
  const [stages, setStages] = useState(() => [...template.stages].sort((a, b) => a.order - b.order));
  const [autoWeights, setAutoWeights] = useState(template.autoWeights !== false);
  const [saving, setSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function toggleEnabled(key) {
    setStages((prev) => {
      const next = prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
      // In manual mode the admin owns the numbers — toggling a stage must not
      // rewrite them (the server normalizes to 100% on save either way).
      return autoWeights ? equalizeScoredWeights(next) : next;
    });
  }

  function changeWeightMode(nextAuto) {
    setAutoWeights(nextAuto);
    // Switching back to auto re-balances straight away rather than waiting for
    // the next stage toggle; switching to manual keeps what's on screen as the
    // starting point.
    if (nextAuto) setStages((prev) => equalizeScoredWeights(prev));
  }

  function changeWeight(key, percent) {
    // `min`/`max` on a number input only restrict the spinner arrows, not typed
    // input — clamp here so a typed "-50" can never become a negative weight
    // (which would subtract from the candidate's weighted total downstream).
    const safe = Math.min(100, Math.max(0, Number(percent) || 0));
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, weight: safe / 100 } : s)));
  }

  function changeGate(key, value) {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, passThreshold: value === '' ? 1 : Number(value) } : s)));
  }

  function moveStage(index, direction) {
    setStages((prev) => {
      const next = [...prev];
      const swapWith = index + direction;
      if (swapWith < 0 || swapWith >= next.length) return prev;
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return reindexOrder(next);
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await api.patch(`/pipelines/${template._id}`, { stages, autoWeights });
      // The server re-normalizes weights (and re-splits them for newly-enabled
      // stages), so the saved values differ from what was posted. This card's
      // `stages` state is seeded once and the card never remounts (stable key),
      // so without syncing it back the inputs would keep showing stale numbers
      // until a full page reload.
      setStages([...res.data.template.stages].sort((a, b) => a.order - b.order));
      setAutoWeights(res.data.template.autoWeights !== false);
      const scored = res.data.template.stages.filter(
        (s) => s.enabled && (s.inputType === 'transcript' || s.inputType === 'artifact')
      );
      toast.success(
        scored.length ? `Saved — ${scored.length} scored stage${scored.length === 1 ? '' : 's'}, weights total 100%.` : 'Saved.'
      );
      onChanged(res.data.template);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault() {
    const res = await api.put(`/pipelines/${template._id}/default`);
    toast.success(`"${res.data.template.name}" is now the default template.`);
    onChanged(res.data.template, true);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/pipelines/${template._id}`);
      toast.success('Template deleted.');
      setConfirmDelete(false);
      onDeleted(template._id);
    } finally {
      setDeleting(false);
    }
  }

  const enabledCount = stages.filter((s) => s.enabled).length;
  const scoredStages = stages.filter((s) => s.enabled && s.inputType !== 'pass_fail' && s.inputType !== 'status_only');

  return (
    <Card>
      <CardContent className="p-0">
        {/* ---------- header ---------- */}
        <div className="flex items-start justify-between gap-3 p-4">
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="flex flex-1 items-start gap-2.5 text-left"
          >
            <ChevronDown
              className={`mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
                {template.isDefault && (
                  <Badge variant="secondary" className="gap-1 bg-[#d21e2b]/10 font-normal text-[#d21e2b] hover:bg-[#d21e2b]/10">
                    <Star className="h-3 w-3" /> Default
                  </Badge>
                )}
                <Badge variant="secondary" className="font-normal">
                  {enabledCount} of {stages.length} stages
                </Badge>
                <Badge variant="secondary" className="font-normal">
                  {autoWeights ? 'Even split' : 'Manual weights'}
                </Badge>
              </div>
              {template.description && (
                <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
              )}
            </div>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="flex-shrink-0">
                <MoreHorizontal />
                <span className="sr-only">Template actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleSetDefault} disabled={template.isDefault}>
                <Star />
                {template.isDefault ? 'Already default' : 'Set as default'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setConfirmDelete(true)}
                disabled={template.isDefault}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 />
                {template.isDefault ? "Can't delete default" : 'Delete template'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ---------- body ---------- */}
        {isOpen && (
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Order</TableHead>
                  <TableHead className="w-12">On</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="hidden sm:table-cell">Input</TableHead>
                  <TableHead className="w-28 text-right">Gate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map((s, index) => (
                  <TableRow key={s.key} className={s.enabled ? '' : 'opacity-60'}>
                    <TableCell className="py-2">
                      <div className="flex flex-col">
                        <button
                          type="button" onClick={() => moveStage(index, -1)} disabled={index === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button" onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Checkbox
                        checked={s.enabled}
                        onCheckedChange={() => toggleEnabled(s.key)}
                        aria-label={`Enable ${s.label}`}
                      />
                    </TableCell>
                    <TableCell className={`py-2 text-sm ${s.enabled ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                      {s.label}
                    </TableCell>
                    <TableCell className="hidden py-2 sm:table-cell">
                      <Badge variant="outline" className="font-normal">
                        {INPUT_TYPE_LABEL[s.inputType] || s.inputType}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      {s.inputType === 'status_only' ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <Input
                            type="number" step="1" min="1" max="5"
                            value={s.passThreshold}
                            onChange={(e) => changeGate(s.key, e.target.value)}
                            onKeyDown={(e) => {
                              if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) {
                                e.preventDefault();
                              }
                            }}
                            className={`ml-auto h-8 w-20 text-xs ${s.passThreshold < 1 || s.passThreshold > 5 || !Number.isInteger(s.passThreshold) ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          />
                          {(s.passThreshold < 1 || s.passThreshold > 5 || !Number.isInteger(s.passThreshold)) && (
                            <span className="text-[10px] text-red-500 leading-tight whitespace-nowrap">Must be 1-5</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* ---------- weights ---------- */}
            <div className="border-t border-border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weights</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {scoredStages.length === 0
                      ? 'Enable a scored stage to assign weights.'
                      : `Across ${scoredStages.length} scored stage${scoredStages.length === 1 ? '' : 's'}.`}
                  </p>
                </div>
                <RadioGroup
                  value={autoWeights ? 'auto' : 'manual'}
                  onValueChange={(v) => changeWeightMode(v === 'auto')}
                  className="flex items-center gap-4"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="auto" id={`auto-${template._id}`} />
                    <Label htmlFor={`auto-${template._id}`} className="cursor-pointer text-xs font-normal">
                      Split evenly
                    </Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="manual" id={`manual-${template._id}`} />
                    <Label htmlFor={`manual-${template._id}`} className="cursor-pointer text-xs font-normal">
                      Set manually
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <WeightConfig stages={stages} onChangeWeight={changeWeight} readOnly={autoWeights} />
            </div>

            <div className="flex justify-end border-t border-border p-4">
              <Button
                onClick={handleSave} disabled={saving || stages.some(s => s.passThreshold < 1 || s.passThreshold > 5 || !Number.isInteger(s.passThreshold))}
                className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* ---------- delete confirmation ---------- */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{template.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This can’t be undone. Requisitions already created from this template keep their own
              copy of the stages, so they aren’t affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-600/90"
            >
              {deleting ? 'Deleting…' : 'Delete template'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function Pipelines() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  async function loadTemplates() {
    setLoading(true);
    try {
      const res = await api.get('/pipelines');
      setTemplates(res.data.templates);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTemplates(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error('Template name is required.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/pipelines', { name: newName, description: newDescription, stages: STAGE_TYPE_DEFAULTS });
      toast.success('Template created — open it to enable stages.');
      setNewName('');
      setNewDescription('');
      setCreateOpen(false);
      loadTemplates();
    } finally {
      setCreating(false);
    }
  }

  function handleChanged(updated, refetchAll) {
    if (refetchAll) loadTemplates();
    else setTemplates((prev) => prev.map((t) => (t._id === updated._id ? updated : t)));
  }

  function handleDeleted(id) {
    setTemplates((prev) => prev.filter((t) => t._id !== id));
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => (
    query
      ? templates.filter((t) => `${t.name || ''} ${t.description || ''}`.toLowerCase().includes(query))
      : templates
  ), [templates, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Pipelines</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${templates.length} template${templates.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
          <Plus />
          New Template
        </Button>
      </div>

      {/* ---------- search ---------- */}
      {(templates.length > 0 || loading) && (
        <div className="relative mt-5 w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search templates…"
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
      <div className="mt-4 space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-start gap-3 p-4">
                <Skeleton className="mt-1 h-4 w-4" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-52" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-8 w-8" />
              </CardContent>
            </Card>
          ))
        ) : templates.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <GitBranch className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No pipeline templates yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  A template defines the interview stages, their order, gates and weights.
                </p>
              </div>
              <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
                <Plus />
                New Template
              </Button>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">No matches for “{search}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different template name.</p>
            </CardContent>
          </Card>
        ) : (
          paginated.map((t) => (
            <TemplateCard key={t._id} template={t} onChanged={handleChanged} onDeleted={handleDeleted} />
          ))
        )}
      </div>

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
            <DialogTitle>New pipeline template</DialogTitle>
            <DialogDescription>
              Every stage type is included but switched off — enable the ones this role needs after creating.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name" value={newName} autoFocus
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Engineering Pipeline"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="tpl-desc" value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Rewritten automatically from the stages you enable"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90">
                {creating ? 'Creating…' : 'Create template'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
