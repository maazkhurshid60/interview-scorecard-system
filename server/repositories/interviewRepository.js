import Interview from '../models/Interview.js';
import { plain } from './plain.js';
import { track, saveEntity } from './entity.js';

/**
 * Everything the app needs from the database about interviews: one stage of one application, with its meeting,
 * transcript or artifact file, scores and status. Only this file (and the model) knows where they live.
 *
 * A full interview comes back as a tracked record: change it in memory, then call `save(interview)`.
 */

const full = (value) => track(plain(value));

/** One interview, or null when there is none with that id. */
export async function findById(id) {
  return full(await Interview.findById(id));
}

/** The interview of this application for this stage, or null. */
export async function findByApplicationAndStage(applicationId, stageKey) {
  return full(await Interview.findOne({ applicationId, stageKey }));
}

/** Every interview of one application. */
export async function listByApplication(applicationId) {
  return full(await Interview.find({ applicationId }));
}

/** The interviews of one application for these stages. */
export async function listByApplicationAndStages(applicationId, stageKeys) {
  return full(await Interview.find({ applicationId, stageKey: { $in: stageKeys } }));
}

/** Every interview of one job opening. */
export async function listByRequisition(requisitionId) {
  return full(await Interview.find({ requisitionId }));
}

/**
 * Interviews as short summaries (`_id`, application, stage, status, stage average), narrowed by any of: one
 * application, several applications, one job opening.
 */
export async function listSummaries({ applicationId, applicationIds, requisitionId }) {
  const filter = {};
  if (applicationId) filter.applicationId = applicationId;
  if (requisitionId) filter.requisitionId = requisitionId;
  if (applicationIds) filter.applicationId = { $in: applicationIds };
  return plain(await Interview.find(filter).select('_id applicationId stageKey status stageAverage'));
}

/** Just the stored artifact file id, meeting event id and provider of each interview of one application. */
export async function listFileAndMeetingInfo(applicationId) {
  return plain(await Interview.find({ applicationId }).select('artifactFilePublicId calendarEventId provider').lean());
}

/** Just the stored artifact file id of each interview of these applications. */
export async function listArtifactFileIds(applicationIds) {
  return plain(await Interview.find({ applicationId: { $in: applicationIds } }).select('artifactFilePublicId').lean());
}

/** True when some interview still uses the stored file with this public id. */
export async function isArtifactFileInUse(publicId) {
  return !!(await Interview.exists({ artifactFilePublicId: publicId }));
}

/** The stored artifact file fields of one interview (url, public id, name, size, type), or null. */
export async function findArtifactFile(id) {
  return plain(await Interview.findById(id).select('artifactFileUrl artifactFilePublicId artifactFileName artifactFileSize artifactFileMimeType'));
}

/** What the AI scoring cost, grouped by job opening, stage and month: `[{ _id: { requisitionId, stageKey, month }, ... }]`. */
export async function summarizeAiCost() {
  return plain(await Interview.aggregate([
    { $match: { aiCostUsd: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: {
          requisitionId: '$requisitionId',
          stageKey: '$stageKey',
          month: { $dateToString: { format: '%Y-%m', date: '$updatedAt' } },
        },
        totalCostUsd: { $sum: '$aiCostUsd' },
        totalInputTokens: { $sum: '$aiTokensUsed.input' },
        totalOutputTokens: { $sum: '$aiTokensUsed.output' },
        interviewCount: { $sum: 1 },
      },
    },
    { $sort: { '_id.month': -1 } },
  ]));
}

/** Creates an interview and returns it. */
export async function create(data) {
  return full(await Interview.create(data));
}

/** Saves the changes made to an interview that was loaded through this repository (see `entity.js`). */
export async function save(interview) {
  return saveEntity(Interview, interview);
}

/** Deletes every interview of one application and returns how many were deleted. */
export async function removeByApplication(applicationId) {
  return (await Interview.deleteMany({ applicationId })).deletedCount;
}

/** Deletes every interview of these applications and returns how many were deleted. */
export async function removeByApplications(applicationIds) {
  return (await Interview.deleteMany({ applicationId: { $in: applicationIds } })).deletedCount;
}

/** Deletes every interview of one job opening and returns how many were deleted. */
export async function removeByRequisition(requisitionId) {
  return (await Interview.deleteMany({ requisitionId })).deletedCount;
}
