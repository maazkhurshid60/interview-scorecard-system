import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, ChevronUp, ChevronDown, Star, Trash2, ArrowLeft } from 'lucide-react';
import api from '../hooks/useApi';
import WeightConfig from '../components/WeightConfig';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

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

function reindexOrder(stages) {
  return stages.map((s, i) => ({ ...s, order: i + 1 }));
}

/** One template's editable card: toggle/reorder stages, edit weights & gates, save/default/delete. */
function TemplateCard({ template, onChanged, onDeleted }) {
  const [stages, setStages] = useState(() => [...template.stages].sort((a, b) => a.order - b.order));
  const [saving, setSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  function toggleEnabled(key) {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s)));
  }

  function changeWeight(key, percent) {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, weight: percent / 100 } : s)));
  }

  function changeGate(key, value) {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, passThreshold: Number(value) } : s)));
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
      const res = await api.patch(`/pipelines/${template._id}`, { stages });
      const newWeights = res.data.template.stages
        .filter((s) => s.enabled && (s.inputType === 'transcript' || s.inputType === 'artifact'))
        .map((s) => `${s.label} ${Math.round(s.weight * 100)}%`)
        .join(', ');
      toast.success(`Weights re-normalized: ${newWeights || 'no scored stages enabled'}`);
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
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    await api.delete(`/pipelines/${template._id}`);
    toast.success('Template deleted.');
    onDeleted(template._id);
  }

  const enabledCount = stages.filter((s) => s.enabled).length;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="flex flex-1 items-start gap-2 text-left"
          >
            <ChevronDown className={`mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
                {template.isDefault && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#d21e2b]/10 px-2 py-0.5 text-xs font-medium text-[#d21e2b]">
                    <Star className="h-3 w-3" /> Default
                  </span>
                )}
                <span className="text-xs text-muted-foreground">({enabledCount} of {stages.length} stages enabled)</span>
              </div>
              {template.description && <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>}
            </div>
          </button>
          <div className="flex flex-shrink-0 gap-2">
            {!template.isDefault && (
              <button type="button" onClick={handleSetDefault} className="text-xs font-medium text-[#d21e2b] hover:text-[#d21e2b]/80">
                Set as default
              </button>
            )}
            {!template.isDefault && (
              <button type="button" onClick={handleDelete} className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" title="Delete template">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {isOpen && (
          <>
            <div className="mt-4 space-y-2">
              {stages.map((s, index) => (
                <div key={s.key} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveStage(index, -1)} disabled={index === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s.key)} className="h-4 w-4 flex-shrink-0 accent-[#d21e2b]" />
                  <span className={`min-w-[8rem] flex-1 ${s.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex-shrink-0 text-xs text-muted-foreground">{s.inputType}</span>
                    {s.inputType !== 'status_only' && (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <label className="text-xs text-muted-foreground">Gate:</label>
                        <input
                          type="number" step="0.1" min="1" max="5"
                          value={s.passThreshold}
                          onChange={(e) => changeGate(s.key, e.target.value)}
                          className="w-16 rounded-md border border-input bg-background px-1.5 py-0.5 text-xs focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Weights</h4>
              <WeightConfig stages={stages} onChangeWeight={changeWeight} />
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="mt-4 rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Pipelines() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

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
      toast.success('Template created — enable and configure stages below.');
      setNewName('');
      setNewDescription('');
      setShowForm(false);
      loadTemplates();
    } finally {
      setCreating(false);
    }
  }

  function handleChanged(updated, refetchAll) {
    if (refetchAll) {
      loadTemplates();
    } else {
      setTemplates((prev) => prev.map((t) => (t._id === updated._id ? updated : t)));
    }
  }

  function handleDeleted(id) {
    setTemplates((prev) => prev.filter((t) => t._id !== id));
  }

  const totalPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedTemplates = templates.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={!canGoBack}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-semibold text-foreground">Pipelines</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-[#d21e2b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {showForm && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>New Template</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground">Template Name</label>
                <input
                  type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Description</label>
                <input
                  type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                />
              </div>
              <p className="text-xs text-muted-foreground">All stage types are included, disabled by default — enable and configure the ones you need after creating.</p>
              <button
                type="submit" disabled={creating}
                className="rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Template'}
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pipeline templates yet.</p>
        ) : (
          paginatedTemplates.map((t) => (
            <TemplateCard key={t._id} template={t} onChanged={handleChanged} onDeleted={handleDeleted} />
          ))
        )}
      </div>

      {!loading && templates.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, templates.length)} of {templates.length} templates
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
