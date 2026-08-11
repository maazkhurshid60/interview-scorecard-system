import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../hooks/useApi';
import { formatScore, formatDisposition } from '../utils/formatters';

const DISPOSITION_BADGE = {
  HIRE: 'bg-green-100 text-green-800',
  MAYBE: 'bg-amber-100 text-amber-800',
  NO_HIRE: 'bg-red-100 text-red-800',
};

const DECISION_LABEL = { hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const DECISION_BADGE = {
  hired: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-gray-200 text-gray-700',
};

/**
 * Ranked candidate table for one requisition — weighted total, disposition,
 * all-gates-passed indicator, and the human final-decision control
 * (hired/rejected/withdrawn, always manual, always audited — the
 * disposition above is only a recommendation).
 *
 * Renders the same per-candidate data two ways: a real table at `md:` and up,
 * and a stacked card per candidate below that — a 6-column table has no room
 * to breathe on a phone, so scrolling to reach most of it isn't a real fix.
 *
 * @param {{ranking: Array<object>, onDecisionRecorded: () => void}} props
 */
export default function CandidateRankTable({ ranking, onDecisionRecorded }) {
  const [openRowId, setOpenRowId] = useState(null);
  const [decisionDraft, setDecisionDraft] = useState('hired');
  const [reasonDraft, setReasonDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...ranking].sort((a, b) => {
    const av = a.weightedTotal ?? -Infinity;
    const bv = b.weightedTotal ?? -Infinity;
    return sortDesc ? bv - av : av - bv;
  });

  function openDecisionForm(app) {
    setOpenRowId(app._id);
    setDecisionDraft('hired');
    setReasonDraft('');
  }

  async function submitDecision(applicationId) {
    if (decisionDraft === 'rejected' && !reasonDraft.trim()) {
      toast.error('A reason is required when rejecting a candidate.');
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/scoring/application/${applicationId}/decision`, {
        decision: decisionDraft,
        reason: reasonDraft.trim() || undefined,
      });
      toast.success(`Recorded: ${DECISION_LABEL[decisionDraft]}.`);
      setOpenRowId(null);
      onDecisionRecorded();
    } finally {
      setSubmitting(false);
    }
  }

  if (ranking.length === 0) {
    return <p className="text-sm text-gray-500">No candidates to rank yet.</p>;
  }

  function GatesCell({ app }) {
    if (app.allGatesPassed === null || app.allGatesPassed === undefined) {
      return <span className="text-xs text-gray-400">Incomplete</span>;
    }
    return app.allGatesPassed ? (
      <span className="text-xs font-medium text-green-700">Yes</span>
    ) : (
      <span className="text-xs font-medium text-red-700">No</span>
    );
  }

  function DispositionCell({ app }) {
    return app.disposition ? (
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${DISPOSITION_BADGE[app.disposition] || ''}`}>
        {formatDisposition(app.disposition)}
      </span>
    ) : (
      <span className="text-xs text-gray-400">—</span>
    );
  }

  function DecisionCell({ app }) {
    if (app.finalDecision) {
      return (
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${DECISION_BADGE[app.finalDecision]}`}>
          {DECISION_LABEL[app.finalDecision]}
        </span>
      );
    }
    if (openRowId === app._id) {
      return (
        <div className="flex flex-col gap-1.5">
          <select
            value={decisionDraft}
            onChange={(e) => setDecisionDraft(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gray-500 focus:outline-none"
          >
            <option value="hired">Hired</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <input
            type="text" value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value)}
            placeholder={decisionDraft === 'rejected' ? 'Reason (required)...' : 'Reason (optional)...'}
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gray-500 focus:outline-none sm:w-40"
          />
          <div className="flex gap-1">
            <button
              type="button" onClick={() => submitDecision(app._id)} disabled={submitting}
              className="rounded-md bg-[#d21e2b] px-2 py-1 text-xs font-medium text-white hover:bg-[#d21e2b]/90 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Confirm'}
            </button>
            <button
              type="button" onClick={() => setOpenRowId(null)}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button" onClick={() => openDecisionForm(app)}
        className="rounded-md border border-[#d21e2b]/40 bg-white px-2 py-1 text-xs font-medium text-[#d21e2b] hover:bg-[#d21e2b]/5"
      >
        Record Decision
      </button>
    );
  }

  return (
    <>
      {/* md: and up — real table, capped height so 100+ rows don't stretch the page; header stays pinned while rows scroll */}
      <div className="hidden max-h-[32rem] overflow-x-auto overflow-y-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-400">
              <th className="sticky top-0 bg-white px-4 py-2">Rank</th>
              <th className="sticky top-0 bg-white px-4 py-2">Candidate</th>
              <th className="sticky top-0 cursor-pointer bg-white px-4 py-2" onClick={() => setSortDesc((v) => !v)}>
                Weighted Total {sortDesc ? '↓' : '↑'}
              </th>
              <th className="sticky top-0 bg-white px-4 py-2">All Gates Passed?</th>
              <th className="sticky top-0 bg-white px-4 py-2">Disposition</th>
              <th className="sticky top-0 bg-white px-4 py-2">Final Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((app) => (
              <tr key={app._id}>
                <td className="px-4 py-3 text-gray-500">{app.rank ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{app.candidateId?.name || 'Unknown'}</div>
                  <div className="text-xs text-gray-400">{app.candidateId?.email}</div>
                </td>
                <td className="px-4 py-3 font-medium">{formatScore(app.weightedTotal)}</td>
                <td className="px-4 py-3"><GatesCell app={app} /></td>
                <td className="px-4 py-3"><DispositionCell app={app} /></td>
                <td className="px-4 py-3"><DecisionCell app={app} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* below md — stacked card per candidate, capped height so 100+ cards don't stretch the page */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setSortDesc((v) => !v)}
          className="mb-3 text-xs font-medium text-gray-500"
        >
          Sort by weighted total {sortDesc ? '↓' : '↑'}
        </button>
        <div className="max-h-[32rem] space-y-3 overflow-y-auto">
          {sorted.map((app) => (
            <div key={app._id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">{app.candidateId?.name || 'Unknown'}</div>
                  <div className="text-xs text-gray-400">{app.candidateId?.email}</div>
                </div>
                <div className="text-xs text-gray-500">Rank {app.rank ?? '—'}</div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-gray-400">Weighted Total</div>
                  <div className="mt-0.5 font-medium text-gray-900">{formatScore(app.weightedTotal)}</div>
                </div>
                <div>
                  <div className="text-gray-400">All Gates Passed?</div>
                  <div className="mt-0.5"><GatesCell app={app} /></div>
                </div>
                <div>
                  <div className="text-gray-400">Disposition</div>
                  <div className="mt-0.5"><DispositionCell app={app} /></div>
                </div>
                <div>
                  <div className="text-gray-400">Final Decision</div>
                  <div className="mt-0.5"><DecisionCell app={app} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
