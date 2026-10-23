import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../hooks/useApi';
import { formatScore } from '../utils/formatters';

function draftsFromInterview(interview, attributes) {
  const map = {};
  (attributes || []).forEach((attr) => {
    const existing = (interview?.scores || []).find((s) => s.attributeId === attr.attributeId);
    map[attr.attributeId] = {
      approvedScore: existing?.approvedScore ?? existing?.aiScore ?? '',
      reason: existing?.overrideReason || '',
    };
  });
  (interview?.scores || []).forEach((s) => {
    if (!map[s.attributeId]) {
      map[s.attributeId] = {
        approvedScore: s.approvedScore ?? s.aiScore ?? '',
        reason: s.overrideReason || '',
      };
    }
  });
  return map;
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
 * @param {{interview: object, attributes?: Array<{attributeId:string, name:string, question:string}>, passThreshold: number, meetingActive?: boolean, onUpdated: (interview: object, stageAverage?: number, passed?: boolean) => void}} props
 */
export default function ScoreReviewTable({ interview, attributes, passThreshold, meetingActive = false, onUpdated }) {
  const attributeById = Object.fromEntries((attributes || []).map((a) => [a.attributeId, a]));
  const [drafts, setDrafts] = useState(() => draftsFromInterview(interview, attributes));
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // Re-sync whenever the interview prop changes so the boxes never show a
  // value that wasn't actually persisted.
  useEffect(() => {
    setDrafts(draftsFromInterview(interview, attributes));
  }, [interview, attributes]);

  const isApproved = interview.status === 'approved';

  function updateDraft(attributeId, field, value) {
    setDrafts((prev) => ({ ...prev, [attributeId]: { ...prev[attributeId], [field]: value } }));
  }

  const formatName = (rawName) => {
    if (!rawName) return 'Evaluation Attribute';
    const str = String(rawName).trim();
    if (str.startsWith('resume_screen') || str.toLowerCase().includes('resume_screen')) {
      return 'Overall Resume & Qualification Evaluation';
    }
    const qMatch = str.match(/_question_(\d+)$/i);
    if (qMatch) return `Question ${qMatch[1]}`;
    const genericMatch = str.match(/^([a-z0-9_]+)_(\d+)_[a-f0-9]+$/i);
    if (genericMatch) {
      const stageName = genericMatch[1].replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      return `${stageName} Attribute ${genericMatch[2]}`;
    }
    return str;
  };

  const displayItems = (attributes && attributes.length > 0)
    ? attributes.map((attr) => {
      const s = (interview?.scores || []).find((score) => score.attributeId === attr.attributeId);
      return {
        attributeId: attr.attributeId,
        name: formatName(attr.name || attr.attributeId),
        question: attr.question,
        aiScore: s?.aiScore,
        aiJustification: s?.aiJustification || (s?.aiScore == null ? 'Live Rating (Manual Entry)' : ''),
        approvedScore: s?.approvedScore,
        overridden: s?.overridden,
      };
    })
    : (interview?.scores || []).map((s) => {
      const attr = attributeById[s.attributeId];
      return {
        ...s,
        name: formatName(attr?.name || s.attributeId),
        question: attr?.question,
      };
    });

  function changedRows() {
    return displayItems.filter((item) => {
      const draft = drafts[item.attributeId];
      if (!draft || draft.approvedScore === '' || draft.approvedScore == null) return false;
      const current = item.approvedScore ?? item.aiScore;
      return Number(draft.approvedScore) !== Number(current);
    });
  }

  const isManualStage = displayItems.every((item) => item.aiScore == null);

  async function handleManualSaveAndApprove() {

    const unrated = displayItems.filter((item) => {
      const draft = drafts[item.attributeId];
      return !draft || draft.approvedScore === '' || draft.approvedScore == null;
    });

    if (unrated.length > 0) {
      toast.error(`Please enter a rating (1-5) for all attributes (${displayItems.length - unrated.length}/${displayItems.length} rated).`);
      return;
    }

    const wasAlreadyApproved = isApproved;
    setApproving(true);
    try {
      const overrides = displayItems.map((item) => ({
        attributeId: item.attributeId,
        approvedScore: Number(drafts[item.attributeId].approvedScore),
        reason: drafts[item.attributeId]?.reason?.trim() || 'Live Interview Rating',
      }));

      const res = await api.patch(`/scoring/interview/${interview._id}/approve`, { overrides });

      toast.success(wasAlreadyApproved ? 'Stage re-approved.' : 'Stage approved!');
      onUpdated(res.data.interview, res.data.stageAverage, res.data.passed, res.data.nextInterviewId, wasAlreadyApproved);
    } catch (err) {
      console.error('[DEBUG - FRONTEND ERROR IN MANUAL SAVE & APPROVE]', err.response?.data || err.message, err);
      toast.error(err.response?.data?.message || 'Could not approve stage scores.');
    } finally {
      setApproving(false);
    }
  }

  async function handleSaveOverrides() {
    const changed = changedRows();
    if (changed.length === 0) {
      toast.error('No scores changed.');
      return;
    }
    const invalidReason = !isManualStage && changed.find((item) => {
      const reason = (drafts[item.attributeId]?.reason || '').trim();
      return reason.length < 10;
    });
    if (invalidReason) {
      toast.error('Every changed score requires an override reason of at least 10 characters.');
      return;
    }

    setSaving(true);
    try {
      const overrides = changed.map((item) => ({
        attributeId: item.attributeId,
        approvedScore: Number(drafts[item.attributeId].approvedScore),
        reason: drafts[item.attributeId]?.reason?.trim() || 'Live Interview Rating',
      }));
      const res = await api.patch(`/scoring/interview/${interview._id}/override`, { overrides });
      toast.success(`Saved ${overrides.length} score(s).${isApproved ? ' Re-approve to fold this into the stage average.' : ''}`);
      onUpdated(res.data.interview);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (changedRows().length > 0) {
      toast.error('You have unsaved score changes — click "Save Overrides" first.');
      return;
    }
    const wasAlreadyApproved = isApproved;
    setApproving(true);
    try {
      const res = await api.patch(`/scoring/interview/${interview._id}/approve`);
      toast.success(wasAlreadyApproved ? 'Stage re-approved.' : 'Stage approved.');
      onUpdated(res.data.interview, res.data.stageAverage, res.data.passed, res.data.nextInterviewId, wasAlreadyApproved);
    } finally {
      setApproving(false);
    }
  }

  const stageAverage = interview.stageAverage;
  const stagePassed = stageAverage != null && passThreshold != null ? stageAverage >= passThreshold : null;

  const liveValues = displayItems
    .map((item) => drafts[item.attributeId]?.approvedScore ?? item.approvedScore ?? item.aiScore)
    .filter((v) => typeof v === 'number' && !isNaN(v));
  const liveAverage = liveValues.length ? liveValues.reduce((a, b) => a + b, 0) / liveValues.length : null;
  const isStale = stageAverage != null && liveAverage != null && Math.abs(liveAverage - stageAverage) > 0.001;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Attribute</th>
              <th className="px-4 py-2">AI Score</th>
              <th className="px-4 py-2">AI Justification</th>
              <th className="px-4 py-2">Score (1-5)</th>
              <th className="px-4 py-2">Notes / Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {displayItems.map((item) => {
              const draft = drafts[item.attributeId] || { approvedScore: '', reason: '' };
              const changed = Number(draft.approvedScore) !== Number(item.approvedScore ?? item.aiScore);
              return (
                <tr key={item.attributeId}>
                  <td className="max-w-[16rem] px-4 py-3 align-top">
                    <div className="font-semibold text-slate-900">
                      {formatName(item.name || item.attributeId)}
                      {item.overridden && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">overridden</span>}
                    </div>
                    {item.question && (
                      <div className="mt-1 text-xs font-normal text-slate-600 leading-snug">
                        {item.question}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{item.aiScore != null ? formatScore(item.aiScore) : '—'}</td>
                  <td className="max-w-xs px-4 py-3 text-xs text-gray-500">{item.aiJustification}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number" min={1} max={5} step={1}
                      value={draft.approvedScore ?? ''}
                      onKeyDown={(e) => {
                        if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (val === '') {
                          updateDraft(item.attributeId, 'approvedScore', '');
                          return;
                        }

                        val = val.slice(-1);
                        const parsed = parseInt(val, 10);
                        if (isNaN(parsed)) return;

                        if (parsed >= 1 && parsed <= 5) {
                          updateDraft(item.attributeId, 'approvedScore', parsed);
                        }
                      }}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none font-semibold text-slate-900"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder={changed ? 'Reason required (min 10 chars)...' : 'Optional notes...'}
                      value={draft.reason}
                      onChange={(e) => updateDraft(item.attributeId, 'reason', e.target.value)}
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

      {meetingActive && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Cancel the active Google Calendar meeting before approving or re-approving this stage.
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
            <span className="text-gray-400">Rate all attributes and approve the stage to compute the average and gate result.</span>
          )}
        </div>
        <div className="flex gap-2">
          {isManualStage ? (
            <button
              type="button" onClick={handleManualSaveAndApprove} disabled={meetingActive || approving || saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {approving ? 'Saving & Approving...' : isApproved ? 'Re-approve Stage Scores' : 'Save & Approve Stage'}
            </button>
          ) : (
            <>
              <button
                type="button" onClick={handleSaveOverrides} disabled={saving}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Overrides'}
              </button>
              <button
                type="button" onClick={handleApprove} disabled={meetingActive || approving}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {approving ? 'Approving...' : isApproved ? 'Re-approve Stage' : 'Approve Stage'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
