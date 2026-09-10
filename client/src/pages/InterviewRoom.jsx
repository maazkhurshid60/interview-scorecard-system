import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ChevronDown } from 'lucide-react';
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
  const [scorecard, setScorecard] = useState(null);
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
  const [openAttrs, setOpenAttrs] = useState(new Set());
  const [guideOpen, setGuideOpen] = useState(false);
  const [startingStage, setStartingStage] = useState(false);
  const [sendingMeetingEmail, setSendingMeetingEmail] = useState(false);

  const [passFailResult, setPassFailResult] = useState('');
  const [passFailSaving, setPassFailSaving] = useState(false);

  const pollTimer = useRef(null);

  const load = useCallback(async () => {
    const { data: interviewData } = await api.get(`/interviews/${id}`);
    setInterview(interviewData.interview);

    const { data: reqData } = await api.get(`/requisitions/${interviewData.interview.requisitionId}`);
    setRequisition(reqData.requisition);
    setScorecard(reqData.scorecard || null);
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
  const stageAttributes = scorecard?.stages?.find((s) => s.stageKey === interview?.stageKey)?.attributes || [];

  useEffect(() => {
    setOpenAttrs(new Set(stageAttributes.length > 0 ? [stageAttributes[0].attributeId] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.stageKey, scorecard]);

  function toggleAttr(attributeId) {
    setOpenAttrs((prev) => {
      const next = new Set(prev);
      if (next.has(attributeId)) next.delete(attributeId);
      else next.add(attributeId);
      return next;
    });
  }

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
      if (res.data.emailSent) {
        toast.success('Meeting set and emailed to candidate.');
      } else {
        toast.success('Meeting set.');
        toast.error(res.data.emailReason || 'Could not email the candidate.');
      }
    } finally {
      setCreatingMeeting(false);
    }
  }

  async function handleResendMeetingEmail() {
    setSendingMeetingEmail(true);
    try {
      const res = await api.post(`/interviews/${id}/send-meeting-email`, {}, { validateStatus: () => true });
      if (res.data?.sent) {
        toast.success('Email sent to candidate.');
      } else {
        toast.error(res.data?.reason || res.data?.message || 'Could not send email.');
      }
    } finally {
      setSendingMeetingEmail(false);
    }
  }

  async function handleStartNextStage(stageKey) {
    setStartingStage(true);
    try {
      const res = await api.post(
        '/interviews',
        { applicationId: application._id, stageKey },
        { validateStatus: () => true }
      );
      if (res.status === 201) {
        navigate(`/interview/${res.data.interview._id}`);
      } else if (res.status === 409 && res.data?.interviewId) {
        // Duplicate interview — open the one that already exists. Out-of-order
        // stage attempts also return 409, but carry no interviewId; those fall
        // through so their "Stage X must be approved first" message is shown.
        navigate(`/interview/${res.data.interviewId}`);
      } else {
        toast.error(res.data?.message || 'Could not start next stage.');
      }
    } finally {
      setStartingStage(false);
    }
  }

  async function handleCancelMeeting() {
    if (!window.confirm('Cancel this meeting? The link will be removed — you can create or paste a new one afterward.')) return;
    setCreatingMeeting(true);
    try {
      const res = await api.delete(`/interviews/${id}/meeting`, { validateStatus: () => true });
      if (res.status >= 400) {
        toast.error(res.data?.message || 'Could not cancel the meeting.');
        return;
      }
      setInterview(res.data.interview);
      toast.success('Meeting cancelled.');
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

  async function handleSavePassFail() {
    if (!passFailResult) return;
    setPassFailSaving(true);

    try {
      const res = await api.post(`/interviews/${id}/pass-fail`, {
        result: passFailResult,
      });

      setInterview(res.data.interview);

      if (res.data.application) {
        setApplication(res.data.application);
      }

      toast.success('Stage decision saved.');
    } finally {
      setPassFailSaving(false);
    }
  }

  const isTranscriptStage = stageConfig?.inputType === 'transcript';
  const canScore = (isTranscriptStage ? interview?.consentObtained : true)
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
            currentStageKey={application?.currentStageKey}
            onStartStage={handleStartNextStage}
            startingStageKey={startingStage ? application?.currentStageKey : null}
          />
        </CardContent>
      </Card>

      {stageAttributes.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            onClick={() => setGuideOpen((v) => !v)}
            className="cursor-pointer flex-row items-center justify-between space-y-0"
          >
            <CardTitle>Interview Guide — {stageConfig?.label}</CardTitle>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
          </CardHeader>
          {guideOpen && (
            <CardContent className="space-y-3">
              {stageAttributes.map((attr) => {
                const isOpen = openAttrs.has(attr.attributeId);
                return (
                  <div key={attr.attributeId} className="rounded-md border border-border p-3">
                    <button
                      type="button"
                      onClick={() => toggleAttr(attr.attributeId)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <p className="text-sm font-semibold text-foreground">{attr.name}</p>
                      <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="mt-3 space-y-2.5">
                        <p className="text-sm text-foreground">{attr.question}</p>
                        <div className="rounded-md border border-green-200 bg-green-50 p-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">What a 5 looks like</p>
                          <p className="mt-1 text-sm text-green-900">{attr.anchor5}</p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Red flags</p>
                          <p className="mt-1 text-sm text-amber-900">{attr.redFlags}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          )}
        </Card>
      )}

      {isTranscriptStage && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Meeting</CardTitle>
            </CardHeader>
            <CardContent>
              {interview.meetingUri && !changingMeeting ? (
                <div className="space-y-2.5">
                  <div>
                    <a href={interview.meetingUri} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-600 hover:underline">
                      {interview.meetingUri}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground">({interview.provider === 'manual' ? 'pasted link' : 'created via Google Meet'})</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button" onClick={() => setChangingMeeting(true)}
                      className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                    >
                      Change
                    </button>
                    <button
                      type="button" onClick={handleResendMeetingEmail} disabled={sendingMeetingEmail}
                      className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendingMeetingEmail ? 'Sending...' : 'Resend Email'}
                    </button>
                    <button
                      type="button" onClick={handleCancelMeeting} disabled={creatingMeeting}
                      className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {creatingMeeting ? 'Cancelling...' : 'Cancel Meeting'}
                    </button>
                  </div>
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
      )}

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
      ) : stageConfig?.inputType === 'pass_fail' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Background Check</CardTitle>
          </CardHeader>

          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Review the background check and record the outcome for this stage.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPassFailResult('pass')}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${passFailResult === 'pass'
                  ? 'border-green-300 bg-green-50 text-slate-900'
                  : 'border-border bg-background text-slate-900 hover:bg-accent'
                  }`}
              >
                Pass
              </button>

              <button
                type="button"
                onClick={() => setPassFailResult('fail')}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${passFailResult === 'fail'
                  ? 'border-red-300 bg-red-50 text-slate-900'
                  : 'border-border bg-background text-slate-900 hover:bg-accent'
                  }`}
              >
                Fail
              </button>
              <button
                type="button"
                onClick={handleSavePassFail}
                disabled={!passFailResult || passFailSaving}
                className="ml-2 rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {passFailSaving ? 'Saving...' : 'Save Decision'}
              </button>
            </div>

            {interview.passFailResult && (
              <p className="mt-3 text-xs text-muted-foreground">
                Saved decision:{' '}
                <span className="font-medium text-foreground">
                  {interview.passFailResult.toUpperCase()}
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">This stage type ("{stageConfig?.inputType}") isn't scored via AI on this screen.</p>
          </CardContent>
        </Card>
      )}

      {stageConfig?.inputType !== 'pass_fail' && (
        <div className="mt-4">
          <button
            type="button" onClick={handleRunScoring} disabled={!canScore || scoring}
            className="rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scoring ? 'Scoring...' : interview.scores?.length ? 'Re-run AI Scoring' : 'Run AI Scoring'}
          </button>
          {!canScore && interview.status !== 'approved' && (isTranscriptStage || stageConfig?.inputType === 'artifact') && (
            <p className="mt-1 text-xs text-muted-foreground">
              {isTranscriptStage ? 'Requires consent + a ready transcript first.' : 'Requires an uploaded artifact first.'}
            </p>
          )}
        </div>
      )}

      {interview.scores?.length > 0 && (
        <div className="mt-4">
          <ScoreReviewTable
            interview={interview}
            attributes={stageAttributes}
            passThreshold={stageConfig?.passThreshold}
            onUpdated={(updatedInterview) => {
              setInterview(updatedInterview);
              if (updatedInterview.status === 'approved') load();
            }}
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
