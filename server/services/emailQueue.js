const EmailJob = require('../models/EmailJob');
const Application = require('../models/Application');
const logger = require('../utils/logger');
const emailNotifier = require('./emailNotifier');

/**
 * Background email queue.
 *
 * Controllers no longer send mail while the person waits. They call
 * enqueueEmail(), which saves a job in the database and returns at once; this
 * queue sends it in the background. The job is stored, so nothing is lost if
 * the server restarts, and a failed attempt (mail server down, slow, or a
 * temporary error) is retried later:
 *
 *   attempts 1..5, waiting 30 s, 2 min, 10 min, 30 min between them
 *   a refused recipient address (SMTP 550-554) or a missing address is NOT retried
 *
 * A sweeper (every 30 s, and at start-up) sends due jobs and recovers jobs a
 * restart left half-way. At most CONCURRENCY emails are sent at once.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000]; // wait before attempts 2, 3, 4, 5
const STALE_LOCK_MS = 5 * 60 * 1000;
const CONCURRENCY = 3;
const DEFAULT_SWEEP_MS = 30 * 1000;
const KEEP_SENT_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_FAILED_MS = 90 * 24 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------- adding emails

/**
 * Saves an email to be sent in the background. Never throws: when it cannot be
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
 * @returns {Promise<{queued: boolean, jobId?: *, reason?: string}>}
 */
async function enqueueEmail({ type, to, payload = {}, attachment, related, dedupeKey }) {
  if (!SENDERS[type]) return { queued: false, reason: `Unknown email type "${type}".` };
  if (!to) return { queued: false, reason: 'No recipient email on file.' };

  try {
    const job = await EmailJob.create({
      type,
      to,
      payload,
      ...(attachment ? { attachment: { filename: attachment.filename, contentType: attachment.contentType || 'application/pdf', content: attachment.content } } : {}),
      ...(related ? { related } : {}),
      ...(dedupeKey ? { dedupeKey } : {}),
    });
    kick(job._id);
    return { queued: true, jobId: job._id };
  } catch (err) {
    if (err.code === 11000 && dedupeKey) {
      const existing = await EmailJob.findOne({ dedupeKey }).select('_id').lean();
      return { queued: true, jobId: existing?._id, duplicate: true };
    }
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
  try {
    const now = new Date();
    const result = await EmailJob.updateMany(
      { type, status: 'pending', 'related.applicationId': applicationId, ...(exceptJobId ? { _id: { $ne: exceptJobId } } : {}) },
      { $set: { status: 'cancelled', lastError: 'Replaced by a newer email.', expireAt: new Date(now.getTime() + KEEP_SENT_MS) }, $unset: { lockedAt: 1, attachment: 1 } },
    );
    return result.modifiedCount || 0;
  } catch (err) {
    logger.warn(`[EmailQueue] Could not cancel older "${type}" emails: ${err.message}`);
    return 0;
  }
}

// ---------------------------------------------------------------- sending one email

/** What to update once an email has really been delivered. */
async function applySentEffects(job) {
  const kind = job.related?.kind;
  const applicationId = job.related?.applicationId;
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
    logger.warn(`[EmailQueue] Email ${job._id} was sent but its record could not be updated: ${err.message}`);
  }
}

async function markSent(job) {
  const now = new Date();
  await EmailJob.updateOne({ _id: job._id }, {
    $set: { status: 'sent', sentAt: now, lastError: null, expireAt: new Date(now.getTime() + KEEP_SENT_MS) },
    $unset: { lockedAt: 1, attachment: 1 }, // the PDF is no longer needed
  });
  logger.info(`[EmailQueue] Sent "${job.type}" email to ${job.to} (attempt ${job.attempts}).`);
  await applySentEffects(job);
}

async function markAttemptFailed(job, result) {
  const now = new Date();
  const reason = String(result?.reason || 'Unknown error').slice(0, 300);
  const finished = result?.permanent === true || job.attempts >= MAX_ATTEMPTS;
  if (finished) {
    await EmailJob.updateOne({ _id: job._id }, {
      $set: { status: 'failed', lastError: reason, expireAt: new Date(now.getTime() + KEEP_FAILED_MS) },
      $unset: { lockedAt: 1, attachment: 1 },
    });
    logger.warn(`[EmailQueue] Giving up on "${job.type}" email to ${job.to} after ${job.attempts} attempt(s): ${reason}`);
    return;
  }
  const wait = BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
  await EmailJob.updateOne({ _id: job._id }, {
    $set: { status: 'pending', lastError: reason, nextAttemptAt: new Date(now.getTime() + wait) },
    $unset: { lockedAt: 1 },
  });
  logger.warn(`[EmailQueue] "${job.type}" email to ${job.to} failed (attempt ${job.attempts}); retrying in ${Math.round(wait / 1000)} s: ${reason}`);
}

/**
 * Sends one queued email if it is due. Safe to call twice: only one caller can claim it.
 * @param {*} jobId
 */
async function processEmailJob(jobId) {
  const now = new Date();
  const job = await EmailJob.findOneAndUpdate(
    { _id: jobId, status: 'pending', nextAttemptAt: { $lte: now } },
    { $set: { status: 'sending', lockedAt: now }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!job) return;

  let result;
  try {
    const attachment = job.attachment?.content
      ? { filename: job.attachment.filename, content: Buffer.from(job.attachment.content) }
      : undefined;
    result = await SENDERS[job.type](job.payload, attachment);
  } catch (err) {
    result = { sent: false, reason: err.message };
  }

  if (result?.sent) await markSent(job);
  else await markAttemptFailed(job, result);
}

// ---------------------------------------------------------------- running the queue

const queued = new Set();   // job ids waiting or running in THIS process
const waiting = [];
let running = 0;

function pump() {
  while (running < CONCURRENCY && waiting.length > 0) {
    const id = waiting.shift();
    running += 1;
    processEmailJob(id)
      .catch((err) => logger.error(`[EmailQueue] Job ${id} crashed: ${err.stack || err.message}`))
      .finally(() => { running -= 1; queued.delete(id); pump(); });
  }
}

/** Puts a job at the back of the line. Returns immediately. */
function kick(jobId) {
  const id = String(jobId);
  if (queued.has(id)) return;
  queued.add(id);
  waiting.push(id);
  setImmediate(pump);
}

/** One pass: recover jobs a restart left half-sent, then queue everything that is due. */
async function sweep() {
  const now = new Date();
  const left = { status: 'sending', lockedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) } };
  await EmailJob.updateMany({ ...left, attempts: { $gte: MAX_ATTEMPTS } }, {
    $set: { status: 'failed', lastError: 'Stopped: sending kept being interrupted.', expireAt: new Date(now.getTime() + KEEP_FAILED_MS) },
    $unset: { lockedAt: 1, attachment: 1 },
  });
  await EmailJob.updateMany({ ...left, attempts: { $lt: MAX_ATTEMPTS } }, {
    $set: { status: 'pending', nextAttemptAt: now },
    $unset: { lockedAt: 1 },
  });
  const due = await EmailJob.find({ status: 'pending', nextAttemptAt: { $lte: now } }).sort({ nextAttemptAt: 1 }).limit(50).select('_id').lean();
  due.forEach((job) => kick(job._id));
}

/**
 * Starts the sweeper: once now (picks up emails left by a restart), then every 30 s.
 * @param {{intervalMs?: number}} [options]
 */
function startEmailQueue({ intervalMs = DEFAULT_SWEEP_MS } = {}) {
  const tick = () => sweep().catch((err) => logger.error(`[EmailQueue] Sweep failed: ${err.message}`));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref(); // never keep the process alive just for this timer
  return timer;
}

module.exports = { enqueueEmail, cancelPendingEmails, processEmailJob, startEmailQueue, sweep, MAX_ATTEMPTS, BACKOFF_MS };
