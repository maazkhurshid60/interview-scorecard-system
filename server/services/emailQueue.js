const { Queue, Worker, UnrecoverableError } = require('bullmq');
const Application = require('../models/Application');
const logger = require('../utils/logger');
const emailNotifier = require('./emailNotifier');
const { redisConfigured, queuePrefix, createRedisConnection, closeRedisConnection, safeJobId, whenReady } = require('../queues/redis');

/**
 * Background email queue, run by BullMQ (on Redis).
 *
 * Controllers do not send mail while the person waits. They call enqueueEmail(), which adds a job to the
 * "emails" queue and returns at once; a BullMQ worker sends it in the background. A failed attempt (mail
 * server down, slow, or a temporary error) is retried by BullMQ:
 *
 *   attempts 1..5, waiting 30 s, 2 min, 10 min, 30 min between them
 *   a refused recipient address (SMTP 550-554) or a missing address is NOT retried
 *
 * BullMQ also does what the hand-written queue used to: keeps waiting jobs across restarts, limits how many
 * are sent at once, and recovers a job whose worker died half-way.
 */

const QUEUE_NAME = 'emails';
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000]; // wait before attempts 2, 3, 4, 5
const CONCURRENCY = 3;
const KEEP_SENT_SECONDS = 30 * 24 * 60 * 60;
const KEEP_FAILED_SECONDS = 90 * 24 * 60 * 60;

/** Which template sends each kind of email. Looked up when sending, so the templates stay in emailNotifier. */
const SENDERS = {
  'meeting-link': (payload) => emailNotifier.sendMeetingLinkEmail(payload),
  'offer-letter': (payload, attachment) => emailNotifier.sendOfferEmail({ ...payload, attachment }),
  'application-confirmation': (payload) => emailNotifier.sendApplicationConfirmationEmail(payload),
  'password-reset': (payload) => emailNotifier.sendPasswordResetEmail(payload),
  'availability-request': (payload) => emailNotifier.sendAvailabilityRequestEmail(payload),
  'onboarding-form': (payload) => emailNotifier.sendOnboardingFormEmail(payload),
  plain: (payload) => emailNotifier.sendEmail(payload), // a ready-made { to, subject, text }
};

// ---------------------------------------------------------------- the queue

let queue = null;
let worker = null;
let queueConnection = null;
let workerConnection = null;

/** The "emails" queue, created on first use. null when Redis is not configured. */
function getQueue() {
  if (!redisConfigured()) return null;
  if (!queue) {
    queueConnection = createRedisConnection({ forQueue: true });
    queue = new Queue(QUEUE_NAME, {
      connection: queueConnection,
      prefix: queuePrefix(),
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'custom' }, // the waits come from BACKOFF_MS, below
        removeOnComplete: { age: KEEP_SENT_SECONDS },
        removeOnFail: { age: KEEP_FAILED_SECONDS },
      },
    });
    queue.on('error', (err) => logger.warn(`[EmailQueue] Queue error: ${err.message}`));
  }
  return queue;
}

// ---------------------------------------------------------------- adding emails

/**
 * Adds an email to be sent in the background. Never throws: when it cannot be
 * queued the reason comes back instead, so the request that asked for the email
 * still succeeds.
 *
 * @param {object} params
 * @param {string} params.type - One of the SENDERS keys.
 * @param {string} params.to - Recipient address (also copied into the payload by the caller as the template needs).
 * @param {object} params.payload - Exactly what the email template needs.
 * @param {{filename: string, content: Buffer, contentType?: string}} [params.attachment] - A PDF to attach.
 * @param {{kind: string, applicationId?: *}} [params.related] - What to update once the email has really been sent.
 * @param {string} [params.dedupeKey] - Queue only one email per key (for example one confirmation per application).
 * @returns {Promise<{queued: boolean, jobId?: string, duplicate?: boolean, reason?: string}>}
 */
async function enqueueEmail({ type, to, payload = {}, attachment, related, dedupeKey }) {
  if (!SENDERS[type]) return { queued: false, reason: `Unknown email type "${type}".` };
  if (!to) return { queued: false, reason: 'No recipient email on file.' };
  const emails = getQueue();
  if (!emails) return { queued: false, reason: 'The email queue is not available (REDIS_URL is not set).' };

  try {
    await whenReady(emails);
    const jobId = dedupeKey ? safeJobId(dedupeKey) : undefined;
    if (jobId) {
      const existing = await emails.getJob(jobId);
      if (existing) return { queued: true, jobId: existing.id, duplicate: true };
    }
    const job = await emails.add(type, {
      type,
      to,
      payload,
      ...(related ? { related: { kind: related.kind, applicationId: related.applicationId ? String(related.applicationId) : undefined } } : {}),
      // The PDF travels inside the job as text and is removed again once the email has been sent.
      ...(attachment ? { attachment: { filename: attachment.filename, contentType: attachment.contentType || 'application/pdf', base64: Buffer.from(attachment.content).toString('base64') } } : {}),
    }, jobId ? { jobId } : {});
    return { queued: true, jobId: job.id };
  } catch (err) {
    logger.error(`[EmailQueue] Could not queue a "${type}" email to ${to}: ${err.message}`);
    return { queued: false, reason: 'Could not queue the email.' };
  }
}

/**
 * Cancels emails of one type for one application that have not been sent yet, so a
 * newer email replaces them instead of the candidate getting both (for example a
 * resent offer letter while the first one is still waiting or retrying).
 * An email that is being sent right now cannot be cancelled.
 * @param {object} params
 * @param {string} params.type
 * @param {*} params.applicationId
 * @param {*} [params.exceptJobId] - The new email, which must stay.
 * @returns {Promise<number>} How many emails were cancelled.
 */
async function cancelPendingEmails({ type, applicationId, exceptJobId }) {
  if (!type || !applicationId) return 0;
  const emails = getQueue();
  if (!emails) return 0;
  try {
    await whenReady(emails);
    const waiting = await emails.getJobs(['waiting', 'delayed', 'prioritized', 'paused']); // not started, or waiting for a retry
    let cancelled = 0;
    for (const job of waiting) {
      const matches = job.data?.type === type
        && String(job.data?.related?.applicationId) === String(applicationId)
        && (exceptJobId === undefined || String(job.id) !== String(exceptJobId));
      if (!matches) continue;
      try {
        await job.remove();
        cancelled += 1;
      } catch (err) {
        logger.info(`[EmailQueue] Email ${job.id} could not be cancelled (it has just started): ${err.message}`);
      }
    }
    return cancelled;
  } catch (err) {
    logger.warn(`[EmailQueue] Could not cancel older "${type}" emails: ${err.message}`);
    return 0;
  }
}

// ---------------------------------------------------------------- sending one email

/** What to update once an email has really been delivered. */
async function applySentEffects(data) {
  const kind = data.related?.kind;
  const applicationId = data.related?.applicationId;
  if (!kind || !applicationId) return;
  const now = new Date();
  try {
    if (kind === 'offer-letter') {
      await Application.updateOne({ _id: applicationId }, { offerLetterDeliveryStatus: 'sent', offerLetterSentAt: now });
    } else if (kind === 'onboarding-form') {
      await Application.updateOne({ _id: applicationId }, { onboardingFormDeliveryStatus: 'sent', onboardingFormSentAt: now });
    } else if (kind === 'application-confirmation') {
      await Application.updateOne({ _id: applicationId }, { 'screeningJob.confirmationEmailSentAt': now });
    }
  } catch (err) {
    logger.warn(`[EmailQueue] The "${kind}" email was sent but its record could not be updated: ${err.message}`);
  }
}

/** The PDF is no longer needed once the email is sent, or once we have given up on it. */
async function dropAttachment(job) {
  if (!job.data?.attachment) return;
  try {
    await job.updateData({ ...job.data, attachment: undefined });
  } catch (err) {
    logger.warn(`[EmailQueue] Could not remove the PDF from email ${job.id}: ${err.message}`);
  }
}

/**
 * Sends one queued email. Throwing makes BullMQ retry it (after the wait in BACKOFF_MS); throwing an
 * UnrecoverableError makes it stop retrying.
 * @param {import('bullmq').Job} job
 */
async function processEmailJob(job) {
  const { type, to, payload, attachment } = job.data;
  const send = SENDERS[type];
  if (!send) throw new UnrecoverableError(`Unknown email type "${type}".`);

  let result;
  try {
    const pdf = attachment?.base64 ? { filename: attachment.filename, content: Buffer.from(attachment.base64, 'base64') } : undefined;
    result = await send(payload, pdf);
  } catch (err) {
    result = { sent: false, reason: err.message };
  }

  if (result?.sent) {
    logger.info(`[EmailQueue] Sent "${type}" email to ${to} (attempt ${job.attemptsMade + 1}).`);
    await applySentEffects(job.data);
    await dropAttachment(job);
    return;
  }
  const reason = String(result?.reason || 'Unknown error').slice(0, 300);
  if (result?.permanent === true) throw new UnrecoverableError(reason);
  throw new Error(reason);
}

// ---------------------------------------------------------------- running the queue

/**
 * Starts the worker that sends the emails. Call once at start-up. Returns null (and logs a warning)
 * when Redis is not configured, so the rest of the app still runs.
 * @returns {import('bullmq').Worker|null}
 */
function startEmailQueue() {
  if (!redisConfigured()) {
    logger.warn('[EmailQueue] REDIS_URL is not set: emails cannot be queued or sent until it is.');
    return null;
  }
  if (worker) return worker;
  getQueue();
  workerConnection = createRedisConnection();
  worker = new Worker(QUEUE_NAME, processEmailJob, {
    connection: workerConnection,
    prefix: queuePrefix(),
    concurrency: CONCURRENCY,
    settings: { backoffStrategy: (attemptsMade) => BACKOFF_MS[Math.min(attemptsMade - 1, BACKOFF_MS.length - 1)] },
  });
  worker.on('error', (err) => logger.error(`[EmailQueue] Worker error: ${err.message}`));
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const finished = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts?.attempts || MAX_ATTEMPTS);
    if (finished) {
      logger.warn(`[EmailQueue] Giving up on "${job.data?.type}" email to ${job.data?.to} after ${job.attemptsMade} attempt(s): ${err.message}`);
      await dropAttachment(job);
    } else {
      const wait = BACKOFF_MS[Math.min(job.attemptsMade - 1, BACKOFF_MS.length - 1)];
      logger.warn(`[EmailQueue] "${job.data?.type}" email to ${job.data?.to} failed (attempt ${job.attemptsMade}); retrying in ${Math.round(wait / 1000)} s: ${err.message}`);
    }
  });
  return worker;
}

/** Stops taking new emails, lets the ones being sent finish, and closes the Redis connections. */
async function closeEmailQueue() {
  const current = worker;
  worker = null;
  if (current) await current.close();
  await closeRedisConnection(workerConnection);
  workerConnection = null;
  const emails = queue;
  queue = null;
  if (emails) await emails.close();
  await closeRedisConnection(queueConnection);
  queueConnection = null;
}

module.exports = { enqueueEmail, cancelPendingEmails, processEmailJob, startEmailQueue, closeEmailQueue, MAX_ATTEMPTS, BACKOFF_MS };
