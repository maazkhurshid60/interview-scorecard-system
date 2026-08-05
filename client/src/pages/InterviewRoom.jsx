import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import api from '../hooks/useApi';
import PipelineStepper from '../components/PipelineStepper';
import ScoreReviewTable from '../components/ScoreReviewTable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatDisposition } from '../utils/formatters';

export default function InterviewRoom() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [interview, setInterview] = useState(null);
  const [requisition, setRequisition] = useState(null);
  const [application, setApplication] = useState(null);
  const [stageLinks, setStageLinks] = useState({});
  const [loading, setLoading] = useState(true);

  const [meetingLinkInput, setMeetingLinkInput] = useState('');
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [changingMeeting, setChangingMeeting] = useState(false);
  const [confirmingConsent, setConfirmingConsent] = useState(false);
  const [fetchingTranscript, setFetchingTranscript] = useState(false);
  const [uploadingTranscript, setUploadingTranscript] = useState(false);
  const [uploadingArtifact, setUploadingArtifact] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputed, setRecomputed] = useState(null);

  const pollTimer = useRef(null);

  const load = useCallback(async () => {
    const { data: interviewData } = await api.get(`/interviews/${id}`);
    setInterview(interviewData.interview);

    const { data: reqData } = await api.get(`/requisitions/${interviewData.interview.requisitionId}`);
    setRequisition(reqData.requisition);
    const app = reqData.applications.find((a) => a._id === interviewData.interview.applicationId);
    setApplication(app || null);

    const { data: siblingData } = await api.get('/interviews', { params: { applicationId: interviewData.interview.applicationId } });
    setStageLinks(Object.fromEntries(siblingData.interviews.map((iv) => [iv.stageKey, iv._id])));

    return interviewData.interview;
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    return () => clearTimeout(pollTimer.current);
  }, [load]);

  const stageConfig = requisition?.stages.find((s) => s.key === interview?.stageKey);

  function stopPolling() {
    clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }

  async function pollTranscript() {
    const res = await api.post(`/interviews/${id}/fetch-transcript`, {}, { validateStatus: () => true });
    if (res.status === 202) {
      const delay = Math.min(Math.max((res.data.retryAfter || 15) * 1000, 5000), 30000);
      pollTimer.current = setTimeout(pollTranscript, delay);
    } else if (res.status === 200) {
      stopPolling();
      setInterview(res.data.interview);
      setFetchingTranscript(false);
      toast.success('Transcript ready.');
    } else {
      stopPolling();
      setFetchingTranscript(false);
      toast.error(res.data?.message || 'Could not fetch transcript.');
    }
  }

  async function handleCreateMeeting(useProvider) {
    setCreatingMeeting(true);
    try {
      const body = useProvider ? {} : { meetingUri: meetingLinkInput.trim() };
      if (!useProvider && !body.meetingUri) {
        toast.error('Paste a meeting link first.');
        return;
      }
      const res = await api.post(`/interviews/${id}/meeting`, body);
      setInterview(res.data.interview);
      setChangingMeeting(false);
      setMeetingLinkInput('');
      toast.success('Meeting set.');
    } finally {
      setCreatingMeeting(false);
    }
  }

  async function handleConfirmConsent() {
    setConfirmingConsent(true);
    try {
      const res = await api.post(`/interviews/${id}/consent`);
      setInterview(res.data.interview);
      toast.success('Consent recorded.');
    } finally {
      setConfirmingConsent(false);
    }
  }

  function handleFetchTranscript() {
    setFetchingTranscript(true);
    pollTranscript();
  }

  async function handleUploadTranscript(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTranscript(true);
    try {
      const body = new FormData();
      body.append('transcript', file);
      const res = await api.post(`/interviews/${id}/upload-transcript`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setInterview(res.data.interview);
      toast.success('Transcript uploaded.');
    } finally {
      setUploadingTranscript(false);
      e.target.value = '';
    }
  }

  async function handleUploadArtifact(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingArtifact(true);
    try {
      const body = new FormData();
      body.append('artifact', file);
      const res = await api.post(`/interviews/${id}/upload-artifact`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setInterview(res.data.interview);
      toast.success('Artifact uploaded.');
    } finally {
      setUploadingArtifact(false);
      e.target.value = '';
    }
  }

  async function handleRunScoring() {
    setScoring(true);
    try {
      const res = await api.post(`/interviews/${id}/score`);
      setInterview(res.data.interview);
      if (res.data.message) toast.error(res.data.message);
      else toast.success('AI scoring complete — review below.');
    } finally {
      setScoring(false);
    }
  }

  async function handleRecompute() {
    setRecomputing(true);
    try {
      const res = await api.post(`/scoring/application/${application._id}/recompute`);
      setRecomputed(res.data.application);
      toast.success('Application results recomputed.');
    } finally {
      setRecomputing(false);
    }
  }

  const canScore = interview?.consentObtained
    && (stageConfig?.inputType === 'artifact' ? !!interview.artifactFileUrl : interview?.transcriptStatus === 'ready')
    && interview?.status !== 'approved';

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!interview || !requisition) return <div className="text-muted-foreground">Interview not found.</div>;

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(`/requisitions/${requisition._id}`)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {requisition.title}
      </button>

      <h1 className="mt-3 text-2xl font-semibold text-foreground">
        {application?.candidateId?.name || 'Candidate'} — {stageConfig?.label || interview.stageKey}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{requisition.title}</p>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <PipelineStepper
            stages={requisition.stages}
            progress={Object.fromEntries((application?.stageProgress || []).map((p) => [p.stageKey, p.status]))}
            stageLinks={stageLinks}
          />
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Meeting</CardTitle>
          </CardHeader>
          <CardContent>
            {interview.meetingUri && !changingMeeting ? (
              <div>
                <a href={interview.meetingUri} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">
                  {interview.meetingUri}
                </a>
                <span className="ml-2 text-xs text-muted-foreground">({interview.provider === 'manual' ? 'pasted link' : 'created via Google Meet'})</span>
                <button
                  type="button" onClick={() => setChangingMeeting(true)}
                  className="ml-2 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {interview.meetingUri && (
                  <button
                    type="button" onClick={() => setChangingMeeting(false)}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    Cancel
                  </button>
                )}
                <div className="flex gap-2">
                  <input
                    type="text" value={meetingLinkInput} onChange={(e) => setMeetingLinkInput(e.target.value)}
                    placeholder="Paste an existing meeting link..."
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
                  />
                  <button
                    type="button" onClick={() => handleCreateMeeting(false)} disabled={creatingMeeting}
                    className="rounded-md border border-[#d21e2b]/40 bg-white px-3 py-1.5 text-sm font-medium text-[#d21e2b] hover:bg-[#d21e2b]/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use Link
                  </button>
                </div>
                <button
                  type="button" onClick={() => handleCreateMeeting(true)} disabled={creatingMeeting}
                  className="rounded-md bg-[#d21e2b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingMeeting ? 'Creating...' : 'Create Google Meet Link'}
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Consent</CardTitle>
          </CardHeader>
          <CardContent>
            {interview.consentObtained ? (
              <p className="text-sm font-medium text-green-700">Candidate consent confirmed.</p>
            ) : (
              <button
                type="button" onClick={handleConfirmConsent} disabled={confirmingConsent}
                className="rounded-md bg-[#d21e2b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmingConsent ? 'Confirming...' : 'Confirm Candidate Consent'}
              </button>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Must be on before AI scoring can run.</p>
          </CardContent>
        </Card>
      </div>

      {stageConfig?.inputType === 'artifact' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Artifact</CardTitle>
          </CardHeader>
          <CardContent>
            {interview.artifactFileUrl ? (
              <a href={interview.artifactFileUrl} target="_blank" rel="noreferrer" className="text-sm text-[#d21e2b] hover:underline">
                View uploaded artifact
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No artifact uploaded yet.</p>
            )}
            <input
              type="file" onChange={handleUploadArtifact} disabled={uploadingArtifact}
              className="mt-2 cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[#d21e2b]/40 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#d21e2b] hover:file:bg-[#d21e2b]/5 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </CardContent>
        </Card>
      ) : stageConfig?.inputType === 'transcript' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            {interview.transcriptStatus === 'ready' ? (
              <p className="text-sm font-medium text-green-700">Transcript ready ({interview.transcriptText?.length || 0} chars).</p>
            ) : interview.transcriptStatus === 'pending' || fetchingTranscript ? (
              <p className="text-sm text-amber-600">Waiting for transcript... (auto-checking)</p>
            ) : (
              <p className="text-sm text-muted-foreground">No transcript yet.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button" onClick={handleFetchTranscript} disabled={fetchingTranscript || !interview.meetingUri}
                className="rounded-md border border-[#d21e2b]/40 bg-white px-3 py-1.5 text-sm font-medium text-[#d21e2b] hover:bg-[#d21e2b]/5 disabled:cursor-not-allowed disabled:opacity-50"
                title={!interview.meetingUri ? 'Set a meeting first' : ''}
              >
                {fetchingTranscript ? 'Fetching...' : 'Fetch Transcript'}
              </button>
              <span className="text-xs text-muted-foreground">or</span>
              <input
                type="file" onChange={handleUploadTranscript} disabled={uploadingTranscript}
                className="cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[#d21e2b]/40 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#d21e2b] hover:file:bg-[#d21e2b]/5 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">This stage type ("{stageConfig?.inputType}") isn't scored via AI on this screen.</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-4">
        <button
          type="button" onClick={handleRunScoring} disabled={!canScore || scoring}
          className="rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scoring ? 'Scoring...' : interview.scores?.length ? 'Re-run AI Scoring' : 'Run AI Scoring'}
        </button>
        {!canScore && interview.status !== 'approved' && (
          <p className="mt-1 text-xs text-muted-foreground">Requires consent + a ready transcript (or artifact) first.</p>
        )}
      </div>

      {interview.scores?.length > 0 && (
        <div className="mt-4">
          <ScoreReviewTable
            interview={interview}
            passThreshold={stageConfig?.passThreshold}
            onUpdated={(updatedInterview) => setInterview(updatedInterview)}
          />
        </div>
      )}

      {interview.status === 'approved' && application && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Application Results</CardTitle>
          </CardHeader>
          <CardContent>
            <button
              type="button" onClick={handleRecompute} disabled={recomputing}
              className="rounded-md border border-[#d21e2b]/40 bg-white px-3 py-1.5 text-sm font-medium text-[#d21e2b] hover:bg-[#d21e2b]/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recomputing ? 'Recomputing...' : 'Recompute Results'}
            </button>
            {recomputed && (
              <p className="mt-2 text-sm">
                Weighted total: <span className="font-semibold">{recomputed.weightedTotal ?? '—'}</span> · Gates passed:{' '}
                <span className="font-semibold">{String(recomputed.allGatesPassed)}</span> · Disposition:{' '}
                <span className="font-semibold">{formatDisposition(recomputed.disposition)}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
