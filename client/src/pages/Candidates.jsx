import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, ArrowLeft } from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '../utils/formatters';

export default function Candidates() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [candidates, setCandidates] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [resumeFile, setResumeFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [attachTarget, setAttachTarget] = useState({}); // candidateId -> selected requisitionId
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

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
      toast.success('Candidate created.');
      setForm({ name: '', email: '', phone: '', notes: '' });
      setResumeFile(null);
      setShowForm(false);
      loadCandidates();
    } finally {
      setCreating(false);
    }
  }

  async function handleAttach(candidateId) {
    const requisitionId = attachTarget[candidateId];
    if (!requisitionId) {
      toast.error('Pick a requisition first.');
      return;
    }
    const res = await api.post(`/candidates/${candidateId}/apply`, { requisitionId }, { validateStatus: () => true });
    if (res.status === 201) {
      toast.success('Attached to requisition.');
    } else if (res.status === 409) {
      toast.error(res.data.message || 'Already attached to this requisition.');
    } else {
      toast.error(res.data?.message || 'Could not attach candidate.');
    }
  }

  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedCandidates = candidates.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
          <h1 className="text-2xl font-semibold text-foreground">Candidates</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-[#d21e2b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90"
        >
          <Plus className="h-4 w-4" />
          New Candidate
        </button>
      </div>

      {showForm && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>New Candidate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground">Name</label>
                  <input
                    type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Email</label>
                  <input
                    type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Phone</label>
                  <input
                    type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Résumé (optional)</label>
                  <input
                    type="file" onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                    className="mt-1 w-full text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Notes</label>
                <textarea
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                />
              </div>
              <button
                type="submit" disabled={creating}
                className="rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Candidate'}
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates yet — create one above.</p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {paginatedCandidates.map((c) => (
                  <li key={c._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.email} {c.phone ? `· ${c.phone}` : ''} · Added {formatDate(c.createdAt)}
                      </div>
                      {c.resumeFileUrl && (
                        <a href={c.resumeFileUrl} target="_blank" rel="noreferrer" className="text-xs text-[#d21e2b] hover:underline">
                          View résumé
                        </a>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-shrink-0 sm:flex-row sm:items-center">
                      <Select
                        value={attachTarget[c._id] || undefined}
                        onValueChange={(v) => setAttachTarget({ ...attachTarget, [c._id]: v })}
                      >
                        <SelectTrigger className="w-full sm:w-48">
                          <SelectValue placeholder="Attach to requisition..." />
                        </SelectTrigger>
                        <SelectContent>
                          {requisitions.map((r) => (
                            <SelectItem key={r._id} value={r._id}>{r.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        onClick={() => handleAttach(c._id)}
                        className="flex-shrink-0 rounded-md border border-[#d21e2b]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#d21e2b] hover:bg-[#d21e2b]/5"
                      >
                        Attach
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {!loading && candidates.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, candidates.length)} of {candidates.length} candidates
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

      <p className="mt-4 text-xs text-muted-foreground">
        After attaching, go to <Link to="/requisitions" className="text-[#d21e2b] underline">Requisitions</Link> → that requisition to start their interviews.
      </p>
    </div>
  );
}
