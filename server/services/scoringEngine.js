import { round } from '../utils/helpers.js';

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
 * What the AI's own scores say about a public application's screening stages. It only ever reads aiScore, and it is only a
 * recommendation for the person who reviews the application: nothing is decided from it.
 * @param {Array<{interview: object, passThreshold: number}>} screened one entry per screening stage
 * @returns {{aiScore: number|null, aiRecommendation: 'advance'|'reject'|null}} null when a stage has no AI scores
 */
function computeScreeningRecommendation(screened) {
  const stages = screened.map(({ interview, passThreshold }) => {
    const proposed = (interview?.scores || []).map((s) => s.aiScore).filter((v) => typeof v === 'number' && !Number.isNaN(v));
    return { average: proposed.length ? proposed.reduce((sum, v) => sum + v, 0) / proposed.length : null, passThreshold };
  });
  if (stages.length === 0 || stages.some((stage) => stage.average === null)) return { aiScore: null, aiRecommendation: null };
  return {
    aiScore: round(stages.reduce((sum, stage) => sum + stage.average, 0) / stages.length, 4),
    aiRecommendation: stages.every((stage) => stage.average >= stage.passThreshold) ? 'advance' : 'reject',
  };
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
 * - A reviewer's decision on a screening stage (stageGates) is that stage's gate
 *   result, whatever its score: the score is a recommendation, the person decides.
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
 * @param {Record<string, boolean>} [params.stageGates] - stageKey -> a reviewer's decision (see services/screeningReview.js).
 * @returns {{
 *   stageResults: Array<{stageKey:string, label:string, inputType:string, weight:number, passThreshold:number, stageAverage:number|null, passed:boolean|null, complete:boolean}>,
 *   weightedTotal: number|null,
 *   allGatesPassed: boolean|null,
 *   disposition: 'HIRE'|'MAYBE'|'NO_HIRE'|null,
 *   complete: boolean
 * }}
 */
function computeApplicationResult({ stages, interviewsByStageKey, hireThreshold, maybeThreshold, stageGates = {} }) {
  const relevantStages = (stages || []).filter((s) => s.enabled && s.inputType !== 'status_only');

  const stageResults = relevantStages.map((stage) => {
    const interview = interviewsByStageKey.get(stage.key);

    // pass_fail stages use the explicit pass/fail decision,
    // not approved scores.
    if (stage.inputType === 'pass_fail') {
      const stageAverage =
        interview?.status === 'approved' &&
          typeof interview?.stageAverage === 'number'
          ? interview.stageAverage
          : null;

      const passed =
        stageAverage === null
          ? null
          : stageAverage >= (stage.passThreshold ?? 5);

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
    }

    // All normal scored stages continue using approved scores.
    const stageAverage = interview
      ? computeStageAverage(interview)
      : null;

    const passed = stageGates[stage.key] ?? isStagePassed(
      stageAverage,
      stage.passThreshold
    );

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
  const anyGateFailed = stageResults.some((r) => r.passed === false);

  if (anyGateFailed) {
    return { stageResults, weightedTotal: null, allGatesPassed: false, disposition: 'NO_HIRE', complete };
  }

  if (!complete) {
    return { stageResults, weightedTotal: null, allGatesPassed: null, disposition: null, complete: false };
  }

  const allGatesPassed = stageResults.every((r) => r.passed === true);

  const scoredStages = stageResults.filter(
    (r) => r.inputType !== 'pass_fail'
  );

  const weightedTotal = scoredStages.length > 0
    ? round(
      scoredStages.reduce(
        (sum, r) => sum + r.stageAverage * r.weight,
        0
      ),
      4
    )
    : null;

  let disposition;

  if (allGatesPassed && weightedTotal === null) {
    disposition = 'HIRE';
  } else if (allGatesPassed && weightedTotal >= hireThreshold) {
    disposition = 'HIRE';
  } else if (allGatesPassed && weightedTotal >= maybeThreshold) {
    disposition = 'MAYBE';
  } else {
    disposition = 'NO_HIRE';
  }

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

export { computeStageAverage, isStagePassed, computeScreeningRecommendation, computeApplicationResult, rankApplications };