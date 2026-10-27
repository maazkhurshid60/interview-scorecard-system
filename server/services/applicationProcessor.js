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
const { Queue, Worker, UnrecoverableError } = require('bullmq');
const { redisConfigured, queuePrefix, createRedisConnection, closeRedisConnection, safeJobId, whenReady } = require('../queues/redis');
const { syncHrQuestionnaireRubric, assignMissingAttributeIds } = require('../utils/scorecardHelpers');

/**
 * Background processing of a PUBLIC job application.
 *
 * The apply request only saves the application (and its files) and answers the
 * candidate straight away. Everything slow happens here instead: creating the
 * scorecard if the job has none, AI-scoring the résumé and the questionnaire,
 * approving those scores, ranking, and the confirmation email.
 *
 * The work is queued with BullMQ (on Redis), which runs it, waits between retries and recovers a job whose
 * worker died. The job's state is also kept on the application itself (`screeningJob.status`:
 * pending -> processing -> completed | failed): the screens read it, and a check every minute puts any
 * application that is still waiting back in the queue if Redis ever lost the job. Every step checks what is
 * already done, so running a job again never scores or emails twice.
 */

const QUEUE_NAME = 'application-screening';
const MAX_ATTEMPTS = 3;
const RETRY_WAIT_MS = 60 * 1000;      // wait before the 2nd attempt; doubles for the 3rd
const STALE_LOCK_MS = 10 * 60 * 1000; // a job "processing" longer than this was left behind by a crash
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
    status = permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'; // pending = BullMQ tries again after a wait
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
  return { status, lastError };
}

/**
 * Processes one application: this is what the BullMQ worker runs for each job. Throwing makes BullMQ try again
 * after a wait; throwing an UnrecoverableError makes it stop.
 * @param {import('bullmq').Job} job - job.data.applicationId is the application to process.
 */
async function processApplication(job) {
  // BullMQ gives a job to one worker at a time, so an application that is still "processing" here was left
  // behind by a crashed attempt and is taken over. One that is completed or failed (or deleted) is skipped.
  const claimed = await Application.findOneAndUpdate(
    { _id: job.data.applicationId, 'screeningJob.status': { $in: ['pending', 'processing'] } },
    { $set: { 'screeningJob.status': 'processing', 'screeningJob.lockedAt': new Date() }, $inc: { 'screeningJob.attempts': 1 } },
    { new: true },
  );
  if (!claimed) return; // done already, or the application no longer exists

  const failures = [];
  try {
    await runSteps(claimed, failures);
  } catch (err) {
    failures.push(err);
    logger.error(`[AppProcessor] Unexpected error for application ${claimed._id}: ${err.stack || err.message}`);
  }
  const { status, lastError } = await finishJob(claimed, failures);
  if (status === 'pending') throw new Error(lastError || 'Screening did not finish.'); // BullMQ retries after a wait
  if (status === 'failed' && failures.length > 0) throw new UnrecoverableError(lastError || 'Screening failed.');
}

// ---------------------------------------------------------------- queue

let queue = null;
let worker = null;
let queueConnection = null;
let workerConnection = null;
let reconcileTimer = null;

/** The screening queue, created on first use. null when Redis is not configured. */
function getQueue() {
  if (!redisConfigured()) return null;
  if (!queue) {
    queueConnection = createRedisConnection({ forQueue: true });
    queue = new Queue(QUEUE_NAME, {
      connection: queueConnection,
      prefix: queuePrefix(),
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: RETRY_WAIT_MS },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    });
    queue.on('error', (err) => logger.warn(`[AppProcessor] Queue error: ${err.message}`));
  }
  return queue;
}

/**
 * Adds an application to the queue. Returns immediately; the work happens in the background. Never throws: if
 * Redis is down the application stays "pending" in the database and the check below queues it later.
 * An application is queued once at a time: asking again while it is waiting or running does nothing.
 * @returns {Promise<{queued: boolean, duplicate?: boolean, reason?: string}>}
 */
async function enqueueApplication(applicationId) {
  const screening = getQueue();
  if (!screening) return { queued: false, reason: 'The screening queue is not available (REDIS_URL is not set).' };
  try {
    await whenReady(screening);
    const jobId = safeJobId(applicationId);
    const existing = await screening.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') return { queued: true, duplicate: true };
      await existing.remove(); // an old finished job with this id must not block a new attempt
    }
    await screening.add('screen', { applicationId: String(applicationId) }, { jobId });
    return { queued: true };
  } catch (err) {
    logger.error(`[AppProcessor] Could not queue application ${applicationId}: ${err.message}`);
    return { queued: false, reason: 'Could not queue the application.' };
  }
}

/**
 * One check: applications the database still shows as waiting are queued (a no-op for ones already in the queue),
 * and ones stuck "processing" by a crash long ago are put back to waiting, or marked failed after too many tries.
 */
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
  for (const application of pending) await enqueueApplication(application._id);
}

/**
 * Starts the worker that screens applications, and the once-a-minute check above (also run now, to pick up
 * work left by a restart). Returns null (and logs a warning) when Redis is not configured.
 * @param {{intervalMs?: number}} [options]
 * @returns {import('bullmq').Worker|null}
 */
function startApplicationProcessor({ intervalMs = DEFAULT_SWEEP_MS } = {}) {
  if (!redisConfigured()) {
    logger.warn('[AppProcessor] REDIS_URL is not set: applications cannot be screened in the background until it is.');
    return null;
  }
  if (worker) return worker;
  getQueue();
  workerConnection = createRedisConnection();
  worker = new Worker(QUEUE_NAME, processApplication, {
    connection: workerConnection,
    prefix: queuePrefix(),
    concurrency: CONCURRENCY,
    lockDuration: 120 * 1000, // one AI call can take up to 3 minutes; BullMQ renews the lock while the job runs
  });
  worker.on('error', (err) => logger.error(`[AppProcessor] Worker error: ${err.message}`));
  worker.on('failed', (job, err) => {
    if (job) logger.warn(`[AppProcessor] Screening job for application ${job.data?.applicationId} failed (attempt ${job.attemptsMade}): ${err.message}`);
  });

  const tick = () => sweep().catch((err) => logger.error(`[AppProcessor] Sweep failed: ${err.message}`));
  tick();
  reconcileTimer = setInterval(tick, intervalMs);
  reconcileTimer.unref(); // never keep the process alive just for this timer
  return worker;
}

/** Stops taking new applications, lets the ones running finish, and closes the Redis connections. */
async function closeApplicationProcessor() {
  if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
  const current = worker;
  worker = null;
  if (current) await current.close();
  await closeRedisConnection(workerConnection);
  workerConnection = null;
  const screening = queue;
  queue = null;
  if (screening) await screening.close();
  await closeRedisConnection(queueConnection);
  queueConnection = null;
}

module.exports = { enqueueApplication, processApplication, startApplicationProcessor, closeApplicationProcessor, sweep, MAX_ATTEMPTS };
