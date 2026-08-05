import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, ArrowLeft } from 'lucide-react';
import api from '../hooks/useApi';
import ScorecardEditor from '../components/ScorecardEditor';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '../utils/formatters';

const STATUS_BADGE = {
  open: 'bg-green-100 text-green-800',
  on_hold: 'bg-amber-100 text-amber-800',
  closed: 'bg-gray-100 text-gray-600',
};

export default function Requisitions() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [requisitions, setRequisitions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', jobDescription: '', pipelineTemplateId: '' });
  const [creating, setCreating] = useState(false);

  // After creation: the newly-created requisition + its freshly generated scorecard,
  // shown inline for immediate review/editing before returning to the list.
  const [reviewRequisition, setReviewRequisition] = useState(null);
  const [reviewScorecard, setReviewScorecard] = useState(null);
  const [savingScorecard, setSavingScorecard] = useState(false);

  async function loadRequisitions() {
    setLoading(true);
    try {
      const res = await api.get('/requisitions', { params: statusFilter ? { status: statusFilter } : {} });
      setRequisitions(res.data.requisitions);
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
      toast.success('Requisition created. Generating scorecard from the JD...');

      const scorecardRes = await api.post(`/requisitions/${requisition._id}/generate-scorecard`);
      toast.success('Scorecard generated — review and edit below.');

      setReviewRequisition(requisition);
      setReviewScorecard(scorecardRes.data.scorecard);
      setShowForm(false);
      setForm({ title: '', jobDescription: '', pipelineTemplateId: '' });
      loadRequisitions();
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveScorecard(stages) {
    setSavingScorecard(true);
    try {
      await api.patch(`/requisitions/${reviewRequisition._id}/scorecard`, { stages });
      toast.success('Scorecard saved.');
    } finally {
      setSavingScorecard(false);
    }
  }

  const stageLabels = reviewRequisition
    ? Object.fromEntries(reviewRequisition.stages.map((s) => [s.key, s.label]))
    : {};

  if (reviewRequisition && reviewScorecard) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{reviewRequisition.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review the AI-generated scorecard below, edit anything, then save.</p>

        <div className="mt-6">
          <ScorecardEditor scorecard={reviewScorecard} stageLabels={stageLabels} onSave={handleSaveScorecard} saving={savingScorecard} />
        </div>

        <div className="mt-6 flex gap-3">
          <Link to={`/requisitions/${reviewRequisition._id}`} className="text-sm font-medium text-[#d21e2b] hover:text-[#d21e2b]/80">
            Go to requisition detail →
          </Link>
          <button
            type="button"
            onClick={() => { setReviewRequisition(null); setReviewScorecard(null); }}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Back to list
          </button>
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-semibold text-foreground">Requisitions</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-[#d21e2b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90"
        >
          <Plus className="h-4 w-4" />
          New Requisition
        </button>
      </div>

      {showForm && (
        <Card className="mt-4 shadow-md">
          <CardHeader>
            <CardTitle>New Requisition</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Sales Executive / Closer"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Job Description</label>
                <textarea
                  value={form.jobDescription}
                  onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
                  rows={6}
                  placeholder="Paste the full job description here..."
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Pipeline Template</label>
                <Select
                  value={form.pipelineTemplateId || undefined}
                  onValueChange={(v) => setForm({ ...form, pipelineTemplateId: v })}
                >
                  <SelectTrigger className="mt-1 w-full">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t._id} value={t._id}>
                        {t.name}{t.isDefault ? ' (default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Creating & generating scorecard...' : 'Create & Generate Scorecard'}
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48">
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

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : requisitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requisitions yet — create one above.</p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {requisitions.map((r) => (
                  <li key={r._id}>
                    <Link to={`/requisitions/${r._id}`} className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[#d21e2b]/5">
                      <div>
                        <div className="text-sm font-medium text-foreground">{r.title}</div>
                        <div className="text-xs text-muted-foreground">Created {formatDate(r.createdAt)}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE[r.status] || ''}`}>
                        {r.status.replace('_', ' ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
