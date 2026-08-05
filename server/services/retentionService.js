const logger = require('../utils/logger');
const Requisition = require('../models/Requisition');
const Interview = require('../models/Interview');
const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const { destroyFile } = require('../config/cloudinary');

const DAY_MS = 24 * 60 * 60 * 1000;
let intervalHandle = null;

/**
 * Reads the current retention window (days). 0 means never delete.
 * @returns {Promise<number>}
 */
async function getRetentionDays() {
  const setting = await Setting.findOne({ key: 'transcriptRetentionDays' });
  return Number(setting?.value ?? process.env.TRANSCRIPT_RETENTION_DAYS ?? 90);
}

/**
 * Purges the raw content of one interview: transcript text, the uploaded
 * artifact file (and the file itself on Cloudinary), and each score's AI
 * justification text. NEVER touches numeric scores, stageAverage, or any
 * other part of the permanent decision record.
 * @param {import('mongoose').Document} interview
 */
async function purgeInterview(interview) {
  if (interview.artifactFilePublicId) {
    try {
      await destroyFile(interview.artifactFilePublicId);
    } catch (err) {
      logger.warn(`[RetentionService] Could not delete Cloudinary file ${interview.artifactFilePublicId}: ${err.message}`);
    }
  }

  interview.transcriptText = undefined;
  interview.artifactFileUrl = undefined;
  interview.artifactFilePublicId = undefined;
  interview.scores.forEach((score) => { score.aiJustification = undefined; });
  interview.markModified('scores');

  await interview.save();
}

/**
 * Purges every interview under one closed requisition that still has
 * something to purge, then writes a single audit entry noting the purge.
 * @param {import('mongoose').Document} requisition
 * @returns {Promise<number>} Number of interviews purged.
 */
async function purgeRequisition(requisition) {
  const interviews = await Interview.find({ requisitionId: requisition._id });
  let purgedCount = 0;

  for (const interview of interviews) {
    const hasSomethingToPurge = interview.transcriptText
      || interview.artifactFileUrl
      || (interview.scores || []).some((s) => s.aiJustification);
    if (!hasSomethingToPurge) continue;
    await purgeInterview(interview);
    purgedCount += 1;
  }

  await AuditLog.create({
    action: 'retention_purge',
    requisitionId: requisition._id,
    targetType: 'requisition',
    targetId: requisition._id.toString(),
    newValue: { purgedInterviews: purgedCount },
    reason: `Transcript retention purge — requisition closed ${requisition.closedAt ? requisition.closedAt.toISOString() : 'unknown'}, retention window elapsed.`,
  });

  logger.info(`[RetentionService] Purged ${purgedCount} interview(s) for requisition ${requisition._id} ("${requisition.title}").`);
  return purgedCount;
}

/**
 * Finds every closed requisition whose closedAt is older than the retention
 * window and purges its interviews' raw content. Safe to call repeatedly —
 * already-purged interviews are skipped (nothing left to purge).
 * Never throws — a failed sweep is logged and retried on the next tick.
 * @returns {Promise<void>}
 */
async function runRetentionSweep() {
  try {
    const retentionDays = await getRetentionDays();
    if (retentionDays <= 0) {
      logger.info('[RetentionService] Retention disabled (0 = never delete). Skipping sweep.');
      return;
    }

    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    const requisitions = await Requisition.find({ status: 'closed', closedAt: { $lte: cutoff } });

    if (requisitions.length === 0) {
      logger.info('[RetentionService] No closed requisitions past the retention window.');
      return;
    }

    logger.info(`[RetentionService] Sweeping ${requisitions.length} closed requisition(s) past the ${retentionDays}-day retention window.`);
    for (const requisition of requisitions) {
      await purgeRequisition(requisition);
    }
  } catch (err) {
    logger.error(`[RetentionService] Sweep failed: ${err.message}`);
  }
}

/**
 * Starts the retention schedule: runs one sweep immediately (server start),
 * then once every 24h. Simple setInterval, per spec — no cron UI in Phase 1.
 * @returns {NodeJS.Timeout}
 */
function startRetentionSchedule() {
  runRetentionSweep();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(runRetentionSweep, DAY_MS);
  logger.info('[RetentionService] Scheduled daily retention sweep.');
  return intervalHandle;
}

/** Stops the schedule — used in tests/shutdown so the process can exit cleanly. */
function stopRetentionSchedule() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startRetentionSchedule, stopRetentionSchedule, runRetentionSweep };