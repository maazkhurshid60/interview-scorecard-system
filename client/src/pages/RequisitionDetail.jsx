import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import api from '../hooks/useApi';
import PipelineStepper from '../components/PipelineStepper';
import ScorecardEditor from '../components/ScorecardEditor';
import CandidateRankTable from '../components/CandidateRankTable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDisposition } from '../utils/formatters';

const DISPOSITION_BADGE = {
  HIRE: 'bg-green-100 text-green-800',
  MAYBE: 'bg-amber-100 text-amber-800',
  NO_HIRE: 'bg-red-100 text-red-800',
};

const STATUS_LABEL = { open: 'Open', on_hold: 'On Hold', closed: 'Closed' };

export default function RequisitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingScorecard, setSavingScorecard] = useState(false);
  const [goingToInterview, setGoingToInterview] = useState(null);
  const [stageLinksByApp, setStageLinksByApp] = useState({});
  const [ranking, setRanking] = useState([]);
  const [savingStatus, setSavingStatus] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/requisitions/${id}`);
      setData(res.data);

      const { data: interviewData } = await api.get('/interviews', { params: { requisitionId: id } });
      const byApp = {};
      interviewData.interviews.forEach((iv) => {
        if (!byApp[iv.applicationId]) byApp[iv.applicationId] = {};
        byApp[iv.applicationId][iv.stageKey] = iv._id;
      });
      setStageLinksByApp(byApp);

      const { data: rankingData } = await api.get(`/requisitions/${id}/ranking`);
      setRanking(rankingData.ranking);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveScorecard(stages) {
    setSavingScorecard(true);
    try {
      await api.patch(`/requisitions/${id}/scorecard`, { stages });
      toast.success('Scorecard saved.');
    } finally {
      setSavingScorecard(false);
    }
  }

  async function handleGoToInterview(app) {
    if (!app.currentStageKey) {
      toast.error('This candidate has no remaining stage — check their pipeline status.');
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
        navigate(`/interview/${res.data.interview._id}`);
      } else if (res.status === 409) {
        navigate(`/interview/${res.data.interviewId}`);
      } else {
        toast.error(res.data?.message || 'Could not open interview.');
      }
    } finally {
      setGoingToInterview(null);
    }
  }

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!data) return <div className="text-muted-foreground">Requisition not found.</div>;

  const { requisition, scorecard, applications } = data;
  const stageLabels = Object.fromEntries(requisition.stages.map((s) => [s.key, s.label]));

  async function handleStatusChange(newStatus) {
    if (newStatus === requisition.status) return;
    if (newStatus === 'closed') {
      const confirmed = window.confirm(
        'Close this requisition? This starts the data-retention countdown for its interview transcripts.'
      );
      if (!confirmed) return;
    }
    setSavingStatus(true);
    try {
      await api.patch(`/requisitions/${id}`, { status: newStatus });
      toast.success(`Requisition marked ${STATUS_LABEL[newStatus].toLowerCase()}.`);
      load();
    } finally {
      setSavingStatus(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          disabled={!canGoBack}
          className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-2xl font-semibold text-foreground">{requisition.title}</h1>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Status:</span>
        <Select value={requisition.status} onValueChange={handleStatusChange} disabled={savingStatus}>
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineStepper stages={requisition.stages} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No candidates attached to this requisition yet.</p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
              {applications.map((app) => {
                const progressMap = Object.fromEntries((app.stageProgress || []).map((p) => [p.stageKey, p.status]));
                return (
                  <li key={app._id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="w-40 flex-shrink-0">
                      <div className="text-sm font-medium text-foreground">{app.candidateId?.name || 'Unknown'}</div>
                      <div className="text-xs text-muted-foreground">{app.candidateId?.email}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <PipelineStepper stages={requisition.stages} progress={progressMap} stageLinks={stageLinksByApp[app._id]} compact />
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3">
                      {app.disposition ? (
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${DISPOSITION_BADGE[app.disposition] || ''}`}>
                          {formatDisposition(app.disposition)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">In progress</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleGoToInterview(app)}
                        disabled={goingToInterview === app._id || !app.currentStageKey}
                        className="rounded-md border border-[#d21e2b]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#d21e2b] hover:bg-[#d21e2b]/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {goingToInterview === app._id ? 'Opening...' : 'Go to Interview'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Scorecard</h2>
        {scorecard ? (
          <ScorecardEditor scorecard={scorecard} stageLabels={stageLabels} onSave={handleSaveScorecard} saving={savingScorecard} />
        ) : (
          <p className="text-sm text-muted-foreground">No scorecard generated yet.</p>
        )}
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Ranking</h2>
        <CandidateRankTable ranking={ranking} onDecisionRecorded={load} />
      </div>
    </div>
  );
}
