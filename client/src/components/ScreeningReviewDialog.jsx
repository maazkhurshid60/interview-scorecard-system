import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, Sparkles, XCircle } from 'lucide-react';
import api from '../hooks/useApi';
import { openStoredFile } from '../lib/fileAccess';
import { formatDate, formatScore } from '../utils/formatters';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const MIN_REASON_LENGTH = 10;
const DECISION_LABEL = { advance: 'Advanced', reject: 'Rejected' };

function aiAverage(interview) {
  const scores = (interview?.scores || []).map((s) => s.aiScore).filter((v) => typeof v === 'number');
  return scores.length ? scores.reduce((sum, v) => sum + v, 0) / scores.length : null;
}

function StageEvidence({ stage, answers }) {
  const average = aiAverage(stage.interview);
  const scores = stage.interview?.scores || [];
  const attributes = stage.attributes.length > 0 ? stage.attributes : scores.map((s) => ({ attributeId: s.attributeId, name: s.attributeId }));

  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <h3 className="text-sm font-semibold">{stage.label}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">AI average {formatScore(average)} / gate {formatScore(stage.passThreshold)}</span>
          {stage.interview?.artifactFileName && (
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openStoredFile('artifact', stage.interview._id)}>
              <FileText className="h-3.5 w-3.5" /> Open CV
            </Button>
          )}
        </div>
      </div>
      {scores.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">The AI has not scored this stage.</p>
      ) : (
        <div className="divide-y">
          {attributes.map((attribute) => {
            const score = scores.find((s) => s.attributeId === attribute.attributeId);
            const answer = attribute.question ? answers?.[attribute.question] : null;
            return (
              <div key={attribute.attributeId} className="space-y-1.5 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{attribute.question || attribute.name}</p>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">AI {score?.aiScore ?? '—'}</span>
                </div>
                {answer && <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm text-slate-700">{answer}</p>}
                <p className="text-sm text-muted-foreground">{score?.aiJustification || 'No explanation was given.'}</p>
                {(attribute.anchor5 || attribute.redFlags) && (
                  <details className="group text-xs text-muted-foreground">
                    <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
                      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" /> What it was scored against
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {attribute.anchor5 && <p><span className="font-medium text-green-700">A 5 looks like:</span> {attribute.anchor5}</p>}
                      {attribute.redFlags && <p><span className="font-medium text-amber-700">Red flags:</span> {attribute.redFlags}</p>}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * One candidate's screening on one card: what the code checked, what the AI proposed and why, and the reviewer's decision.
 * The AI only recommends. A person advances or rejects here, one candidate at a time (there is deliberately no way to
 * decide for several at once), and their name, the time and their reason are recorded.
 *
 * @param {{applicationId: string|null, onClose: () => void, onDecided: () => void}} props
 */
export default function ScreeningReviewDialog({ applicationId, onClose, onDecided }) {
  const [card, setCard] = useState(null);
  const [reason, setReason] = useState('');
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCard(null);
    setReason('');
    setChanging(false);
    if (!applicationId) return undefined;
    let current = true;
    api.get(`/scoring/application/${applicationId}/screening-review`)
      .then((res) => { if (current) setCard(res.data); })
      .catch(() => { if (current) onClose(); }); // the API client already showed the error
    return () => { current = false; };
  }, [applicationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const application = card?.application;
  const review = application?.screeningReview;
  const candidate = application?.candidateId;
  const checks = application?.requirements?.checks || [];
  const unmet = checks.filter((check) => !check.met);
  const belowRequirements = review?.status === 'requirements_not_met';
  const deciding = review?.status === 'needs_review' || belowRequirements || changing;
  const trimmed = reason.trim();

  function needsReason(decision) {
    return decision === 'reject' || decision !== review?.aiRecommendation;
  }

  function reasonIsMissing() {
    if (trimmed.length >= MIN_REASON_LENGTH) return false;
    toast.error(`Please give a reason of at least ${MIN_REASON_LENGTH} characters.`);
    return true;
  }

  async function decide(decision) {
    if (needsReason(decision) && reasonIsMissing()) return;
    setSaving(true);
    try {
      await api.patch(`/scoring/application/${applicationId}/screening-review`, { decision, reason: trimmed || undefined, changeDecision: changing || undefined });
      toast.success(decision === 'advance' ? 'Candidate advanced.' : 'Candidate rejected.');
      onDecided();
      onClose();
    } catch {
      // The API client already showed the error.
    } finally {
      setSaving(false);
    }
  }

  async function sendToScreening() {
    if (reasonIsMissing()) return;
    setSaving(true);
    try {
      await api.patch(`/scoring/application/${applicationId}/screening-review/continue`, { reason: trimmed });
      toast.success('Candidate sent on to AI screening.');
      onDecided();
      onClose();
    } catch {
      // The API client already showed the error.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(applicationId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review {candidate?.name || 'candidate'}</DialogTitle>
          <DialogDescription>
            {card ? `${card.requisition.title}${candidate?.email ? ` · ${candidate.email}` : ''}${candidate?.phone ? ` · ${candidate.phone}` : ''}` : 'Loading…'}
          </DialogDescription>
        </DialogHeader>

        {!card ? (
          <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-32 w-full" /></div>
        ) : (
          <div className="space-y-4">
            {review?.status === 'reviewed' && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  {DECISION_LABEL[review.decision]} by {card.reviewerName || 'a reviewer'} on {formatDate(review.reviewedAt)}
                </p>
                {review.reason && <p className="mt-1 text-muted-foreground">{review.reason}</p>}
              </div>
            )}

            {belowRequirements ? (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  This candidate's form answers do not meet the job's minimum requirements, so the AI has not looked at them.
                  Nothing has been decided: reject them, or send them on to AI screening if you think they should continue.
                </p>
              </div>
            ) : review?.aiRecommendation && (
              <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">AI recommendation: {review.aiRecommendation === 'advance' ? 'Advance' : 'Do not advance'}</span>
                  {' '}(average score {formatScore(review.aiScore)}). This is only a recommendation. Check the evidence below: the decision is yours.
                </p>
              </div>
            )}

            {checks.length > 0 && (
              <section className="rounded-lg border">
                <h3 className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">Minimum requirements (the candidate's own answers, checked without AI)</h3>
                <div className="divide-y">
                  {checks.map((check) => (
                    <div key={check.criteria} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>{check.criteria}: <span className="text-muted-foreground">{check.required}</span></span>
                      <span className={`flex shrink-0 items-center gap-1 font-medium ${check.met ? 'text-green-700' : 'text-red-700'}`}>
                        {check.met ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        {check.answered}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {card.stages.map((stage) => <StageEvidence key={stage.key} stage={stage} answers={application.questionnaireAnswers} />)}

            {deciding && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="screening-review-reason">Reason</Label>
                  {belowRequirements && unmet.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-brand hover:underline"
                      onClick={() => setReason(`Did not meet the minimum requirements: ${unmet.map((check) => check.criteria).join(', ')}.`)}
                    >
                      Use the unmet requirements as the reason
                    </button>
                  )}
                </div>
                <Textarea
                  id="screening-review-reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={belowRequirements ? 'Required.' : 'Required to reject, or to go against the AI recommendation.'}
                />
                <p className="text-xs text-muted-foreground">Your name, the time and this reason are recorded.</p>
              </div>
            )}
          </div>
        )}

        {card && (
          <DialogFooter className="gap-2 sm:gap-2">
            {deciding ? (
              <>
                <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button type="button" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => decide('reject')} disabled={saving}>
                  Reject
                </Button>
                {belowRequirements ? (
                  <Button type="button" className="bg-brand text-white hover:bg-brand/90" onClick={sendToScreening} disabled={saving}>Send to AI screening</Button>
                ) : (
                  <Button type="button" className="bg-brand text-white hover:bg-brand/90" onClick={() => decide('advance')} disabled={saving}>Advance</Button>
                )}
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={onClose}>Close</Button>
                {card.laterStageStarted ? (
                  <p className="self-center text-xs text-muted-foreground">This candidate has started a later stage, so this review can no longer be changed.</p>
                ) : review?.status === 'reviewed' && (
                  <Button type="button" variant="outline" onClick={() => setChanging(true)}>Change decision</Button>
                )}
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
