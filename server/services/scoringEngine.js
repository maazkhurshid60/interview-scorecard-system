const { round } = require('../utils/helpers');

/**
 * Pure calculation module — no API calls, no database access. This is the
 * exact logic from the original Excel, generalized to N stages. The caller
 * (scoringController) fetches the requisition/interviews from Mongo,
 * invokes these functions, and persists whatever it gets back. Re-run
 * whenever an approval/override changes a score.
 */

/**
 * Averages the approvedScore of every attribute on an interview.
 * Guards divide-by-zero: if there are no approved scores yet, the stage is
 * INCOMPLETE, not 0 — returns null, never 0.
 * @param {{scores?: Array<{approvedScore?: number}>}} interview
 * @returns {number|null}
 */
function computeStageAverage(interview) {
  const approved = (interview?.scores || [])
    .map((s) => s.approvedScore)
    .filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (approved.length === 0) return null;
  const mean = approved.reduce((sum, v) => sum + v, 0) / approved.length;
  return round(mean, 4);
}

/**
 * @param {number|null} stageAverage
 * @param {number} passThreshold
 * @returns {boolean|null} null if the stage is incomplete (stageAverage is null).
 */
function isStagePassed(stageAverage, passThreshold) {
  if (stageAverage === null || stageAverage === undefined) return null;
  return stageAverage >= passThreshold;
}

/**
 * Computes one application's full result: per-stage average/gate, weighted
 * total, allGatesPassed, and disposition.
 *
 * CRITICAL RULES (from spec):
 * - A high weightedTotal can NEVER produce HIRE unless allGatesPassed is true.
 * - pass_fail stages contribute to allGatesPassed but NOT to weightedTotal.
 * - status_only stages (e.g. offer) have no gate and no weight — skipped entirely.
 * - weightedTotal always uses approvedScore, never aiScore (computeStageAverage
 *   only ever reads approvedScore).
 * - If any enabled, gate-or-scored stage is incomplete, the WHOLE application's
 *   weightedTotal/allGatesPassed/disposition are null (incomplete), never a
 *   premature verdict — this extends the spec's per-stage divide-by-zero
 *   guard to the overall computation, since a partial weighted sum or a
 *   partially-evaluated AND would misrepresent an in-progress candidate.
 *
 * @param {object} params
 * @param {Array<{key:string, label:string, enabled:boolean, inputType:string, weight:number, passThreshold:number}>} params.stages
 *   The requisition's (snapshotted) stage configs.
 * @param {Map<string, object>} params.interviewsByStageKey - stageKey -> most relevant Interview doc.
 * @param {number} params.hireThreshold
 * @param {number} params.maybeThreshold
 * @returns {{
 *   stageResults: Array<{stageKey:string, label:string, inputType:string, weight:number, passThreshold:number, stageAverage:number|null, passed:boolean|null, complete:boolean}>,
 *   weightedTotal: number|null,
 *   allGatesPassed: boolean|null,
 *   disposition: 'HIRE'|'MAYBE'|'NO_HIRE'|null,
 *   complete: boolean
 * }}
 */
function computeApplicationResult({ stages, interviewsByStageKey, hireThreshold, maybeThreshold }) {
  const relevantStages = (stages || []).filter((s) => s.enabled && s.inputType !== 'status_only');

  const stageResults = relevantStages.map((stage) => {
    const interview = interviewsByStageKey.get(stage.key);
    const stageAverage = interview ? computeStageAverage(interview) : null;
    const passed = isStagePassed(stageAverage, stage.passThreshold);
    return {
      stageKey: stage.key,
      label: stage.label,
      inputType: stage.inputType,
      weight: stage.weight,
      passThreshold: stage.passThreshold,
      stageAverage,
      passed,
      complete: stageAverage !== null,
    };
  });

  const complete = stageResults.every((r) => r.complete);

  if (!complete) {
    return { stageResults, weightedTotal: null, allGatesPassed: null, disposition: null, complete: false };
  }

  const allGatesPassed = stageResults.every((r) => r.passed === true);

  const weightedTotal = round(
    stageResults
      .filter((r) => r.inputType !== 'pass_fail')
      .reduce((sum, r) => sum + r.stageAverage * r.weight, 0),
    4
  );

  let disposition;
  if (allGatesPassed && weightedTotal >= hireThreshold) disposition = 'HIRE';
  else if (allGatesPassed && weightedTotal >= maybeThreshold) disposition = 'MAYBE';
  else disposition = 'NO_HIRE';

  return { stageResults, weightedTotal, allGatesPassed, disposition, complete: true };
}

/**
 * Ranks applications within a requisition by weightedTotal descending.
 * Ties share the same rank (competition ranking: 1, 2, 2, 4 — not 1,2,2,3).
 * Incomplete applications (weightedTotal null) sort last and get rank null,
 * since they have no verdict to rank yet.
 *
 * @param {Array<{weightedTotal: number|null}>} applications
 * @returns {Array<object>} New array (same object references), each with `.rank` set.
 */
function rankApplications(applications) {
  const withTotal = applications.filter((a) => typeof a.weightedTotal === 'number');
  const withoutTotal = applications.filter((a) => typeof a.weightedTotal !== 'number');

  withTotal.sort((a, b) => b.weightedTotal - a.weightedTotal);

  let rank = 0;
  let seen = 0;
  let previousTotal;
  withTotal.forEach((app) => {
    seen += 1;
    if (app.weightedTotal !== previousTotal) {
      rank = seen;
      previousTotal = app.weightedTotal;
    }
    app.rank = rank;
  });
  withoutTotal.forEach((app) => { app.rank = null; });

  return [...withTotal, ...withoutTotal];
}

module.exports = { computeStageAverage, isStagePassed, computeApplicationResult, rankApplications };