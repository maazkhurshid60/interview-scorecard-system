import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../hooks/useApi';
import { formatScore } from '../utils/formatters';

function draftsFromInterview(interview) {
  return Object.fromEntries(
    interview.scores.map((s) => [s.attributeId, { approvedScore: s.approvedScore ?? s.aiScore, reason: s.overrideReason || '' }])
  );
}

/**
 * Per-attribute AI score + justification next to an editable approved score.
 * Changing a value away from the AI score requires a reason and is batched
 * into one PATCH /scoring/interview/:id/override call. "Approve Stage" fills
 * any attribute the reviewer didn't touch with its AI score (backend-side).
 *
 * Approving isn't a hard lock — the backend allows overriding and
 * re-approving a stage that's already approved, so a mistake can be fixed
 * without reopening the whole interview. Local edits always sync back to
 * whatever the server actually saved (never show a number that wasn't
 * persisted, e.g. after Approve silently discards an unsaved edit).
 *
 * @param {{interview: object, attributes?: Array<{attributeId:string, name:string, question:string}>, passThreshold: number, onUpdated: (interview: object, stageAverage?: number, passed?: boolean) => void}} props
 */
export default function ScoreReviewTable({ interview, attributes, passThreshold, onUpdated }) {
  const attributeById = Object.fromEntries((attributes || []).map((a) => [a.attributeId, a]));
  const [drafts, setDrafts] = useState(() => draftsFromInterview(interview));
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // Re-sync whenever the interview prop changes (after a fresh scoring run,
  // an override save, or an approve) so the boxes never show a value that
  // wasn't actually persisted.
  useEffect(() => {
    setDrafts(draftsFromInterview(interview));
  }, [interview]);

  const isApproved = interview.status === 'approved';

  function updateDraft(attributeId, field, value) {
    setDrafts((prev) => ({ ...prev, [attributeId]: { ...prev[attributeId], [field]: value } }));
  }

  function changedRows() {
    return interview.scores.filter((s) => {
      const draft = drafts[s.attributeId];
      const current = s.approvedScore ?? s.aiScore;
      return Number(draft.approvedScore) !== Number(current);
    });
  }

  async function handleSaveOverrides() {
    const changed = changedRows();
    if (changed.length === 0) {
      toast.error('No scores changed.');
      return;
    }
    const missingReason = changed.find((s) => !drafts[s.attributeId].reason?.trim());
    if (missingReason) {
      toast.error('Every changed score needs a reason.');
      return;
    }

    setSaving(true);
    try {
      const overrides = changed.map((s) => ({
        attributeId: s.attributeId,
        approvedScore: Number(drafts[s.attributeId].approvedScore),
        reason: drafts[s.attributeId].reason.trim(),
      }));
      const res = await api.patch(`/scoring/interview/${interview._id}/override`, { overrides });
      toast.success(`Saved ${overrides.length} override(s).${isApproved ? ' Re-approve to fold this into the stage average.' : ''}`);
      onUpdated(res.data.interview);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (changedRows().length > 0) {
      toast.error('You have unsaved score changes — click "Save Overrides" first, or they will be discarded.');
      return;
    }
    const wasAlreadyApproved = isApproved;
    setApproving(true);
    try {
      const res = await api.patch(`/scoring/interview/${interview._id}/approve`);
      console.log('[DEBUG - FRONTEND SCORE REVIEW RESPONSE]', res.data);
      toast.success(wasAlreadyApproved ? 'Stage re-approved.' : 'Stage approved.');
      onUpdated(res.data.interview, res.data.stageAverage, res.data.passed, res.data.nextInterviewId, wasAlreadyApproved);
    } finally {
      setApproving(false);
    }
  }

  const stageAverage = interview.stageAverage;
  const stagePassed = stageAverage != null && passThreshold != null ? stageAverage >= passThreshold : null;

  // stageAverage is a cached field — only Approve/Re-approve recomputes and
  // saves it. Saving an override alone leaves it stale, so detect that and
  // say so plainly instead of silently showing an out-of-date PASS/FAIL.
  const liveValues = interview.scores.map((s) => s.approvedScore ?? s.aiScore).filter((v) => typeof v === 'number');
  const liveAverage = liveValues.length ? liveValues.reduce((a, b) => a + b, 0) / liveValues.length : null;
  const isStale = stageAverage != null && liveAverage != null && Math.abs(liveAverage - stageAverage) > 0.001;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Five columns (one holding a 224px input) can't fit a phone — scroll the
          table inside its own container rather than letting the page scroll
          sideways. min-w keeps the columns readable while scrolling. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-400">
            <th className="px-4 py-2">Attribute</th>
            <th className="px-4 py-2">AI Score</th>
            <th className="px-4 py-2">AI Justification</th>
            <th className="px-4 py-2">Approved Score</th>
            <th className="px-4 py-2">Override Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {interview.scores.map((s) => {
            const draft = drafts[s.attributeId];
            const changed = Number(draft.approvedScore) !== Number(s.approvedScore ?? s.aiScore);
            const attr = attributeById[s.attributeId];
            return (
              <tr key={s.attributeId}>
                <td className="max-w-[14rem] px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {attr?.name || s.attributeId}
                    {s.overridden && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">overridden</span>}
                  </div>
                  {attr?.question && <div className="mt-0.5 text-xs text-gray-400">{attr.question}</div>}
                </td>
                <td className="px-4 py-3 text-gray-700">{formatScore(s.aiScore)}</td>
                <td className="max-w-xs px-4 py-3 text-xs text-gray-500">{s.aiJustification}</td>
                <td className="px-4 py-3">
                  <input
                    type="number" min={1} max={5} step={0.5}
                    value={draft.approvedScore ?? ''}
                    onChange={(e) => updateDraft(s.attributeId, 'approvedScore', e.target.value)}
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    placeholder={changed ? 'Reason required...' : 'Only needed if you change the score'}
                    value={draft.reason}
                    onChange={(e) => updateDraft(s.attributeId, 'reason', e.target.value)}
                    className="w-56 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {isStale && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Scores changed since this was last approved — the result below is stale. Live average from
          current scores would be <span className="font-semibold">{formatScore(liveAverage)}</span>{' '}
          ({liveAverage >= passThreshold ? 'would PASS' : 'would still FAIL'}). Click <span className="font-semibold">Re-approve Stage</span> to make it official.
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {stageAverage != null ? (
            <span>
              Stage average: <span className="font-semibold">{formatScore(stageAverage)}</span> / gate {formatScore(passThreshold)} —{' '}
              <span className={stagePassed ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
                {stagePassed ? 'PASS' : 'FAIL'}
              </span>
              {isApproved && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">approved</span>}
            </span>
          ) : (
            <span className="text-gray-400">Approve the stage to compute the average and gate result.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button" onClick={handleSaveOverrides} disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Overrides'}
          </button>
          <button
            type="button" onClick={handleApprove} disabled={approving}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approving ? 'Approving...' : isApproved ? 'Re-approve Stage' : 'Approve Stage'}
          </button>
        </div>
      </div>
    </div>
  );
}
