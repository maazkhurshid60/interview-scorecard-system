const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const Scorecard = require('../models/Scorecard');
const logger = require('../utils/logger');
const { ApiKeyError, SpendCapError } = require('../utils/errors');
const { generateScorecard } = require('./questionGenerator');
const { scoreInterview } = require('./aiScorer');
const { computeStageAverage, isStagePassed, rankApplications } = require('./scoringEngine');
const { enqueueEmail } = require('./emailQueue');
const { syncHrQuestionnaireRubric, assignMissingAttributeIds } = require('../utils/scorecardHelpers');

/**
 * Background processing of a PUBLIC job application.
 *
 * The apply request only saves the application (and its files) and answers the
 * candidate straight away. Everything slow happens here instead: creating the
 * scorecard if the job has none, AI-scoring the résumé and the questionnaire,
 * approving those scores, ranking, and the confirmation email.
 *
 * The job's state lives on the application itself (`screeningJob.status`:
 * pending -> processing -> completed | failed), so nothing is lost if the server
 * restarts: a sweeper picks up pending jobs, recovers jobs left "processing" by a
 * restart, and retries temporary failures. Every step checks what is already
 * done, so running a job again never scores or emails twice.
 */

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 10 * 60 * 1000; // a job "processing" longer than this was left behind by a restart
const CONCURRENCY = 2;                // at most this many applications are processed at once (limits AI load)
const DEFAULT_SWEEP_MS = 60 * 1000;

// ---------------------------------------------------------------- scorecard

const scorecardInFlight = new Map(); // requisitionId -> Promise: applications arriving together share one AI generation

/** Finds the job's scorecard, generating it once if it does not exist yet, and syncs the HR rubric. */
function ensureScorecard(requisition) {
  const key = String(requisition._id);
  if (scorecardInFlight.has(key)) return scorecardInFlight.get(key);

  const work = (async () => {
    let scorecard = requisition.scorecardId
      ? await Scorecard.findById(requisition.scorecardId)
      : await Scorecard.findOne({ requisitionId: requisition._id });
    if (!scorecard) {
      const generated = await generateScorecard(requisition);
      assignMissingAttributeIds(generated.stages);
      scorecard = await Scorecard.findOne({ requisitionId: requisition._id }); // someone may have created it meanwhile
      if (!scorecard) {
        scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: true, stages: generated.stages });
        await Requisition.updateOne({ _id: requisition._id }, { scorecardId: scorecard._id });
        logger.info(`[AppProcessor] Auto-generated missing scorecard for requisition ${requisition._id}`);
      }
    }
    if (scorecard && syncHrQuestionnaireRubric(scorecard, requisition)) {
      scorecard.markModified('stages');
      await scorecard.save();
    }
    return scorecard;
  })().finally(() => scorecardInFlight.delete(key));

  scorecardInFlight.set(key, work);
  return work;
}

// ---------------------------------------------------------------- one application

/** Approves an interview's AI scores as they are and records the stage result. Returns { stageAverage, stagePassed }. */
async function approveAutoScores(interview, stage, application) {
  interview.scores.forEach((score) => {
    if (score.approvedScore === undefined || score.approvedScore === null) score.approvedScore = score.aiScore;
  });
  interview.status = 'approved';
  interview.markModified('scores');
  const stageAverage = computeStageAverage(interview);
  const stagePassed = isStagePassed(stageAverage, stage.passThreshold);
  interview.stageAverage = stageAverage;
  await interview.save();

  const progress = application.stageProgress.find((p) => p.stageKey === stage.key);
  if (progress) {
    progress.stageAverage = stageAverage;
    progress.passed = stagePassed;
    progress.status = stagePassed ? 'passed' : 'failed';
  }
  return { stageAverage, stagePassed };
}

/** Runs every step for one application. Problems are collected in `failures`; a failed step does not stop the others. */
async function runSteps(application, failures) {
  const requisition = await Requisition.findById(application.requisitionId);
  const candidate = await Candidate.findById(application.candidateId);
  if (!requisition || !candidate) {
    // The job or the candidate was deleted while this waited: nothing left to do.
    logger.warn(`[AppProcessor] Skipping application ${application._id}: its job or candidate no longer exists.`);
    return;
  }
  // scoringController is loaded here, not at the top, because it is a large module that depends on a lot.
  // eslint-disable-next-line global-require
  const { getOrCreateNextInterview, recomputeAndPersist } = require('../controllers/scoringController');

  // 1. Confirmation email — handed to the email queue (one per application, however many times this job
  //    runs), so a mail problem is retried there and never blocks the scoring.
  if (!application.screeningJob.confirmationEmailSentAt) {
    const queuedEmail = await enqueueEmail({
      type: 'application-confirmation',
      to: candidate.email,
      payload: { candidateEmail: candidate.email, candidateName: candidate.name, requisitionTitle: requisition.title },
      related: { kind: 'application-confirmation', applicationId: application._id },
      dedupeKey: `application-confirmation:${application._id}`,
    });
    if (!queuedEmail.queued) {
      logger.warn(`[AppProcessor] Confirmation email not queued for application ${application._id}: ${queuedEmail.reason}`);
    }
  }

  // 2. The scorecard (generated once per job when missing).
  let scorecard = null;
  try {
    scorecard = await ensureScorecard(requisition);
  } catch (err) {
    failures.push(err);
    logger.warn(`[AppProcessor] Could not prepare the scorecard for requisition ${requisition._id}: ${err.message}`);
  }

  const enabledStages = (requisition.stages || []).filter((s) => s.enabled);
  // Public applications always begin with the required résumé screen, even for an older pipeline template.
  const firstStage = enabledStages.find((stage) => stage.key === 'resume_screen') || enabledStages[0] || requisition.stages[0];
  const hrStage = enabledStages.find((stage) => stage.key === 'hr_screen');
  const firstInterview = firstStage ? await Interview.findOne({ applicationId: application._id, stageKey: firstStage.key }) : null;
  const hrInterview = hrStage && hrStage.key !== firstStage?.key
    ? await Interview.findOne({ applicationId: application._id, stageKey: hrStage.key })
    : null;

  // 3. Score the résumé stage using only the CV, JD, and screening criteria.
  if (firstInterview && scorecard && firstStage && firstInterview.status === 'pending') {
    const stageRubric = scorecard.stages.find((s) => s.stageKey === firstStage.key);
    if (stageRubric?.attributes?.length > 0 && firstInterview.transcriptText) {
      try {
        logger.info(`[AppProcessor] Scoring ${firstStage.key} for application ${application._id}...`);
        const { interview: scored } = await scoreInterview({
          interview: firstInterview, stageType: firstStage.stageType, attributes: stageRubric.attributes, requisition, application,
        });
        if (scored) {
          const progress = application.stageProgress.find((p) => p.stageKey === firstStage.key);
          if (progress) progress.status = 'scored';
          await application.save();
        }
      } catch (err) {
        failures.push(err);
        logger.warn(`[AppProcessor] Résumé scoring problem for application ${application._id}: ${err.message}`);
      }
    }
  }

  // 4. Auto-approve the résumé scores and compute the first-stage result.
  //    Also finishes the job after an interrupted attempt: an already-approved stage
  //    still gets its next interview created and the results recomputed (both are repeatable).
  let resumePassed = null;
  if (firstInterview && firstStage) {
    try {
      if (firstInterview.status === 'approved') {
        resumePassed = isStagePassed(firstInterview.stageAverage, firstStage.passThreshold);
      } else if (firstInterview.status === 'scored' || firstInterview.scores?.length > 0) {
        const { stageAverage, stagePassed } = await approveAutoScores(firstInterview, firstStage, application);
        resumePassed = stagePassed;
        application.initialScreening = {
          aiScore: stageAverage,
          aiJustification: firstInterview.scores.map((score) => score.aiJustification).filter(Boolean).join(' '),
          passed: stagePassed,
          overridden: false,
        };
        logger.info(`[AppProcessor] Auto-approved ${firstStage.key} for application ${application._id}: average=${stageAverage}, passed=${stagePassed}`);
      }
      if (resumePassed !== null) {
        if (resumePassed) await getOrCreateNextInterview(application, requisition, firstStage.key, null);
        await recomputeAndPersist(application, requisition, null, resumePassed
          ? 'Auto-approved Stage 1 AI scoring upon public application submission.'
          : 'Auto-computed results after Stage 1 failure.');
      }
    } catch (err) {
      failures.push(err);
      logger.error(`[AppProcessor] Résumé auto-approval error for application ${application._id}: ${err.message}`);
    }
  }

  // 5. Score and approve the HR screen from the questionnaire answers only (never the CV).
  if (hrInterview && scorecard && hrStage) {
    const hrRubric = scorecard.stages.find((stage) => stage.stageKey === hrStage.key);
    try {
      if (hrInterview.status === 'pending' && hrRubric?.attributes?.length > 0) {
        await scoreInterview({
          interview: hrInterview, stageType: hrStage.stageType, attributes: hrRubric.attributes, requisition, application,
        });
      }
      let hrPassed = null;
      if (hrInterview.status === 'scored') {
        ({ stagePassed: hrPassed } = await approveAutoScores(hrInterview, hrStage, application));
      } else if (hrInterview.status === 'approved') {
        hrPassed = isStagePassed(hrInterview.stageAverage, hrStage.passThreshold);
      }
      if (hrPassed !== null) {
        // Continue to later stages only when both required public screens pass.
        // HR is still scored when the résumé fails.
        if (hrPassed && resumePassed) {
          await getOrCreateNextInterview(application, requisition, hrStage.key, null);
        }
        await recomputeAndPersist(application, requisition, null, 'Auto-approved HR questionnaire scoring upon public application submission.');
      }
    } catch (err) {
      failures.push(err);
      logger.warn(`[AppProcessor] HR questionnaire scoring problem for application ${application._id}: ${err.message}`);
    }
  }

  // 6. Re-rank every applicant of this job.
  try {
    const allApps = await Application.find({ requisitionId: requisition._id });
    const ranked = rankApplications(allApps);
    for (const app of ranked) {
      await Application.updateOne({ _id: app._id }, { rank: app.rank });
    }
  } catch (err) {
    logger.warn(`[AppProcessor] Ranking error for requisition ${requisition._id}: ${err.message}`);
  }
}

/** Works out the job's final state from what went wrong (if anything) and saves it. */
async function finishJob(application, failures) {
  const attempts = application.screeningJob.attempts;
  const permanent = failures.find((err) => err instanceof ApiKeyError || err instanceof SpendCapError);
  let status = 'completed';
  if (failures.length > 0) {
    // A bad key or a reached spend cap will not fix itself, so it is not retried (staff can score by hand).
    status = permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'; // pending = retried by the sweeper
  }
  const lastError = failures.map((err) => err.message).join('; ').slice(0, 500);

  await Application.updateOne({ _id: application._id }, {
    $set: {
      'screeningJob.status': status,
      'screeningJob.lastError': lastError || null,
      ...(status === 'pending' ? {} : { 'screeningJob.completedAt': new Date() }),
    },
    $unset: { 'screeningJob.lockedAt': 1 },
  });
  logger.info(`[AppProcessor] Application ${application._id} -> ${status} (attempt ${attempts}${lastError ? `, issue: ${lastError}` : ''}).`);
}

/**
 * Processes one application if it is waiting. Safe to call twice: only one call can claim the job.
 * @param {string|import('mongoose').Types.ObjectId} applicationId
 */
async function processApplication(applicationId) {
  const claimed = await Application.findOneAndUpdate(
    { _id: applicationId, 'screeningJob.status': 'pending' },
    { $set: { 'screeningJob.status': 'processing', 'screeningJob.lockedAt': new Date() }, $inc: { 'screeningJob.attempts': 1 } },
    { new: true },
  );
  if (!claimed) return; // not waiting (done already, or another worker has it)

  const failures = [];
  try {
    await runSteps(claimed, failures);
  } catch (err) {
    failures.push(err);
    logger.error(`[AppProcessor] Unexpected error for application ${claimed._id}: ${err.stack || err.message}`);
  }
  await finishJob(claimed, failures);
}

// ---------------------------------------------------------------- queue + sweeper

const queued = new Set();   // application ids waiting or running in THIS process
const waiting = [];
let running = 0;

function pump() {
  while (running < CONCURRENCY && waiting.length > 0) {
    const id = waiting.shift();
    running += 1;
    processApplication(id)
      .catch((err) => logger.error(`[AppProcessor] ${id} crashed: ${err.stack || err.message}`))
      .finally(() => { running -= 1; queued.delete(id); pump(); });
  }
}

/** Puts an application at the back of the line. Returns immediately; the work happens in the background. */
function enqueueApplication(applicationId) {
  const id = String(applicationId);
  if (queued.has(id)) return;
  queued.add(id);
  waiting.push(id);
  setImmediate(pump);
}

/** One pass: recover jobs a restart left behind, then queue everything that is waiting. */
async function sweep() {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const left = { 'screeningJob.status': 'processing', 'screeningJob.lockedAt': { $lt: staleBefore } };
  await Application.updateMany({ ...left, 'screeningJob.attempts': { $gte: MAX_ATTEMPTS } }, {
    $set: { 'screeningJob.status': 'failed', 'screeningJob.completedAt': new Date(), 'screeningJob.lastError': 'Stopped: processing kept being interrupted.' },
    $unset: { 'screeningJob.lockedAt': 1 },
  });
  await Application.updateMany({ ...left, 'screeningJob.attempts': { $lt: MAX_ATTEMPTS } }, {
    $set: { 'screeningJob.status': 'pending' },
    $unset: { 'screeningJob.lockedAt': 1 },
  });
  const pending = await Application.find({ 'screeningJob.status': 'pending' }).sort({ createdAt: 1 }).limit(20).select('_id').lean();
  pending.forEach((app) => enqueueApplication(app._id));
}

/**
 * Starts the sweeper: once now (picks up work left by a restart), then every minute.
 * @param {{intervalMs?: number}} [options]
 */
function startApplicationProcessor({ intervalMs = DEFAULT_SWEEP_MS } = {}) {
  const tick = () => sweep().catch((err) => logger.error(`[AppProcessor] Sweep failed: ${err.message}`));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref(); // never keep the process alive just for this timer
  return timer;
}

module.exports = { enqueueApplication, processApplication, startApplicationProcessor, sweep, MAX_ATTEMPTS };
