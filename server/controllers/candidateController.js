import { isValidId } from '../repositories/ids.js';
import * as candidateRepo from '../repositories/candidateRepository.js';
import * as applicationRepo from '../repositories/applicationRepository.js';
import * as interviewRepo from '../repositories/interviewRepository.js';
import * as auditLog from '../repositories/auditLogRepository.js';
import * as requisitionRepo from '../repositories/requisitionRepository.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/helpers.js';
import { ValidationError } from '../utils/errors.js';
import { assertRequisitionOpen } from '../utils/requisitionStatus.js';
import { uploadFile, deleteFile } from '../services/fileStorage.js';
import { assertPdfUpload } from '../utils/uploadValidation.js';
import { destroyFileIfUnreferenced } from '../services/fileReferenceCleanup.js';
import * as transcriptProvider from '../services/transcriptProvider.js';
import { enqueueEmail } from '../services/emailQueue.js';

const PHONE_NUMBER_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK_IMPORT_ROWS = 500;

function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) {
    throw new ValidationError(['email'], 'Email is required.');
  }
  if (!EMAIL_PATTERN.test(value)) {
    throw new ValidationError(['email'], 'Please enter a valid email address.');
  }
  return value;
}

function validatePhone(phone, required = false) {
  const value = String(phone || '').trim();
  if ((required && !value) || (value && !PHONE_NUMBER_PATTERN.test(value))) {
    throw new ValidationError(['phone'], 'Phone number must contain exactly 11 digits.');
  }
  return value;
}

/**
 * GET /api/candidates — server-paginated candidates, each with the
 * requisitions it is already attached to.
 *
 * The attachments are resolved here in two queries rather than left to the
 * client, which would otherwise need one request per requisition just to
 * answer "is this person already in a pipeline?" — and without that answer the
 * only way to find out is to attempt an attach and read the 409.
 */
const list = asyncHandler(async (req, res) => {
  let ids; // undefined: every candidate; a list: only those
  if (req.query.requisitionId && req.query.requisitionId !== 'all') {
    ids = isValidId(req.query.requisitionId)
      ? await applicationRepo.listCandidateIdsForRequisition(req.query.requisitionId)
      : [];
  }

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const { candidates, total, page, totalPages } = await candidateRepo.listPage({
    search: req.query.search,
    ids,
    limit,
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    oldestFirst: req.query.sort === 'oldest',
  });

  const applications = await applicationRepo.listSummariesForCandidates(candidates.map((c) => c._id));
  const requisitions = await requisitionRepo.listTitlesAndStatuses(applications.map((a) => a.requisitionId));
  const requisitionById = new Map(requisitions.map((r) => [String(r._id), r]));

  const requisitionIds = await applicationRepo.listRequisitionIdsWithApplications();
  const requisitionOptions = await requisitionRepo.listTitles(requisitionIds);

  const byCandidate = new Map();
  applications.forEach((a) => {
    const requisition = requisitionById.get(String(a.requisitionId));
    if (!requisition) return;
    const entry = {
      applicationId: a._id,
      requisitionId: a.requisitionId,
      title: requisition.title,
      status: requisition.status,
      currentStageKey: a.currentStageKey,
      disposition: a.disposition ?? null,
    };
    const key = String(a.candidateId);
    if (!byCandidate.has(key)) byCandidate.set(key, []);
    byCandidate.get(key).push(entry);
  });

  res.json({
    candidates: candidates.map((c) => ({ ...c, applications: byCandidate.get(String(c._id)) || [] })),
    requisitionOptions: requisitionOptions.map((r) => ({ id: String(r._id), title: r.title })),
    pagination: { total, page, limit, totalPages },
  });
});

/** POST /api/candidates — create a candidate; `resume` file field is optional (multer). */
const create = asyncHandler(async (req, res) => {
  const { name, email, phone, notes } = req.body;
  if (!name) throw new ValidationError(['name'], 'name is required.');
  const validatedEmail = validateEmail(email);
  const validatedPhone = validatePhone(phone);
  const duplicate = await candidateRepo.findByEmail(validatedEmail);
  if (duplicate) throw new ValidationError(['email'], 'A candidate with this email address already exists.');
  assertPdfUpload(req.file, { field: 'resume', label: 'résumé', required: false });

  let resumeFileUrl;
  let resumeFilePublicId;
  let resumeFileName;
  let resumeFileSize;
  let resumeFileMimeType;
  if (req.file) {
    const uploaded = await uploadFile({ file: req.file, folder: 'resumes' });
    resumeFileUrl = uploaded.url;
    resumeFilePublicId = uploaded.publicId;
    resumeFileName = uploaded.name;
    resumeFileSize = uploaded.size;
    resumeFileMimeType = uploaded.mimeType;
  }

  const candidate = await candidateRepo.create({
    name,
    email: validatedEmail,
    phone: validatedPhone,
    notes,
    resumeFileUrl,
    resumeFilePublicId,
    resumeFileName,
    resumeFileSize,
    resumeFileMimeType,
  });

  logger.info(`[Candidate] Created "${name}" (${candidate._id})${req.file ? ' with résumé' : ''}.`);
  res.status(201).json({ candidate });
});

/**
 * POST /api/candidates/bulk
 * Creates candidates parsed from a CSV preview. Each row is validated again
 * server-side so browser validation cannot create malformed or duplicate data.
 */
const bulkCreate = asyncHandler(async (req, res) => {
  const rows = req.body?.candidates;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ValidationError(['candidates'], 'At least one candidate row is required.');
  }
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    throw new ValidationError(['candidates'], `A maximum of ${MAX_BULK_IMPORT_ROWS} candidates can be imported at once.`);
  }

  const existingEmails = new Set((await candidateRepo.listEmails())
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean));
  const fileEmails = new Set();
  const candidatesToCreate = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const rowNumber = Number(row?.rowNumber) || index + 2;
    const name = String(row?.name || '').trim();
    const email = String(row?.email || '').trim();
    const phone = String(row?.phone || '').trim();
    const notes = String(row?.notes || '').trim();
    const errors = [];

    if (!name) errors.push('Name is required.');
    if (!email) errors.push('Email is required.');
    else if (!EMAIL_PATTERN.test(email)) errors.push('Email address is invalid.');
    if (phone && !PHONE_NUMBER_PATTERN.test(phone)) errors.push('Phone number must contain exactly 11 digits.');

    const emailKey = email.toLowerCase();
    if (emailKey && existingEmails.has(emailKey)) errors.push('A candidate with this email already exists.');
    if (emailKey && fileEmails.has(emailKey)) errors.push('This email appears more than once in the import file.');

    if (errors.length > 0) {
      skipped.push({ rowNumber, errors });
      return;
    }

    if (emailKey) fileEmails.add(emailKey);
    candidatesToCreate.push({ name, email, phone, notes });
  });

  const created = candidatesToCreate.length > 0 ? await candidateRepo.createMany(candidatesToCreate) : [];
  logger.info(`[Candidate] Bulk import: created=${created.length}, skipped=${skipped.length}.`);
  res.status(201).json({
    createdCount: created.length,
    skippedCount: skipped.length,
    skipped,
    candidates: created,
  });
});

/** GET /api/candidates/:id */
const getOne = asyncHandler(async (req, res) => {
  const candidate = await candidateRepo.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });
  res.json({ candidate });
});

/** PATCH /api/candidates/:id */
const update = asyncHandler(async (req, res) => {
  const candidate = await candidateRepo.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const { name, email, phone, notes } = req.body;
  const oldValue = {
    name: candidate.name, email: candidate.email || '', phone: candidate.phone || '', notes: candidate.notes || '',
  };
  const changes = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw new ValidationError(['name'], 'Name is required.');
    changes.name = String(name).trim();
  }
  if (email !== undefined) {
    const cleanEmail = validateEmail(email);
    const duplicate = await candidateRepo.findByEmail(cleanEmail, { exceptId: candidate._id });
    if (duplicate) throw new ValidationError(['email'], 'Another candidate already uses this email address.');
    changes.email = cleanEmail;
  }
  if (phone !== undefined) changes.phone = validatePhone(phone);
  if (notes !== undefined) changes.notes = notes;

  let resumeReplaced = false;
  let replacedResumePublicId = null;
  if (req.file) {
    assertPdfUpload(req.file, { field: 'resume', label: 'résumé' });
    const oldPublicId = candidate.resumeFilePublicId;
    const uploaded = await uploadFile({ file: req.file, folder: 'resumes' });
    Object.assign(changes, {
      resumeFileUrl: uploaded.url,
      resumeFilePublicId: uploaded.publicId,
      resumeFileName: uploaded.name,
      resumeFileSize: uploaded.size,
      resumeFileMimeType: uploaded.mimeType,
    });
    resumeReplaced = true;
    replacedResumePublicId = oldPublicId;
  }

  const updated = await candidateRepo.update(candidate._id, changes);
  if (replacedResumePublicId) {
    destroyFileIfUnreferenced(replacedResumePublicId)
      .catch((err) => logger.warn(`[Candidate] Could not clean up old résumé ${replacedResumePublicId}: ${err.message}`));
  }
  await auditLog.record({
    action: 'candidate_update', userId: req.user._id,
    targetType: 'candidate', targetId: updated._id,
    oldValue, newValue: {
      name: updated.name, email: updated.email || '', phone: updated.phone || '', notes: updated.notes || '', resumeReplaced,
    },
    reason: 'Candidate profile updated.',
  });
  res.json({ candidate: updated });
});

/**
 * POST /api/candidates/:id/apply
 * Attaches a candidate to a requisition, creating the Application record
 * every score will attach to. Refuses to create a duplicate Application for
 * the same candidate+requisition pair.
 */
const apply = asyncHandler(async (req, res) => {
  const candidate = await candidateRepo.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const { requisitionId } = req.body;
  if (!requisitionId) throw new ValidationError(['requisitionId'], 'requisitionId is required.');

  const requisition = await requisitionRepo.findById(requisitionId);
  if (!requisition) throw new ValidationError(['requisitionId'], 'No requisition found with that id.');
  assertRequisitionOpen(requisition, 'attach a candidate');

  const existing = await applicationRepo.findByCandidateAndRequisition(candidate._id, requisitionId);
  if (existing) {
    return res.status(409).json({
      error: 'VALIDATION_ERROR',
      message: 'This candidate already has an application for this job opening.',
      applicationId: existing._id,
    });
  }

  const enabledStages = requisition.stages.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const firstStageKey = enabledStages[0]?.key || null;

  const application = await applicationRepo.create({
    candidateId: candidate._id,
    requisitionId,
    currentStageKey: firstStageKey,
    source: 'manual',
    stageProgress: enabledStages.map((s) => ({ stageKey: s.key, status: 'pending' })),
  });

  logger.info(`[Candidate] ${candidate._id} applied to job ${requisitionId} -> application ${application._id}`);
  res.status(201).json({ application });
});

/**
 * DELETE /api/candidates/:id/requisitions/:requisitionId
 * Removes one candidate from one requisition without touching their profile
 * or applications to other roles. All interview evidence and audit records
 * for that application are removed so no further in-app work can occur.
 */
const removeFromRequisition = asyncHandler(async (req, res) => {
  const candidate = await candidateRepo.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const application = await applicationRepo.findByCandidateAndRequisition(candidate._id, req.params.requisitionId);
  if (!application) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'This candidate is not attached to that requisition.' });
  }

  const interviews = await interviewRepo.listFileAndMeetingInfo(application._id);
  const artifactIds = [...new Set(interviews.map((interview) => interview.artifactFilePublicId).filter(Boolean))];

  // Calendar-based Meet invitations must be cancelled before their database
  // records are removed, so candidates receive Google's cancellation notice.
  const cancellations = await Promise.allSettled(
    interviews.filter((interview) => interview.calendarEventId).map((interview) => transcriptProvider.cancelMeeting(interview))
  );
  if (cancellations.some((result) => result.status === 'rejected')) {
    const error = new Error('Could not cancel all scheduled Calendar meetings. The candidate was not removed. Please try again.');
    error.statusCode = 502;
    throw error;
  }

  // Delete database references first. File cleanup then preserves anything
  // still referenced by the candidate profile or another interview.
  await auditLog.removeForApplication(application._id);
  const interviewsDeleted = await interviewRepo.removeByApplication(application._id);
  await applicationRepo.remove(application._id);

  const cleanupResults = await Promise.allSettled([
    ...artifactIds.map(destroyFileIfUnreferenced),
    // The offer letter belongs to this application alone, so it goes with it.
    ...(application.offerLetterPublicId ? [deleteFile(application.offerLetterPublicId).then(() => true)] : []),
  ]);
  const deletedFiles = cleanupResults.filter((result) => result.status === 'fulfilled' && result.value).length;
  cleanupResults
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.warn(`[Candidate] Could not clean up removed application artifact: ${result.reason?.message || result.reason}`));

  logger.info(`[Candidate] Removed ${candidate._id} from requisition ${req.params.requisitionId}: application=${application._id}, interviews=${interviewsDeleted}, files=${deletedFiles}.`);
  res.json({
    message: 'Candidate removed from this requisition.',
    deleted: { applications: 1, interviews: interviewsDeleted, files: deletedFiles },
  });
});

/**
 * DELETE /api/candidates/:id
 * Permanently removes the candidate and every record/evidence file owned by
 * their applications. Cloudinary files are deleted first so a storage failure
 * cannot leave an apparently-deleted candidate with personal files behind.
 */
const remove = asyncHandler(async (req, res) => {
  const candidate = await candidateRepo.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const applications = await applicationRepo.listOfferLettersForCandidate(candidate._id);
  const applicationIds = applications.map((application) => application._id);
  const interviews = await interviewRepo.listArtifactFileIds(applicationIds);

  const fileIds = [...new Set([
    candidate.resumeFilePublicId,
    ...interviews.map((interview) => interview.artifactFilePublicId),
    ...applications.map((application) => application.offerLetterPublicId), // offer letters belong to the application
  ].filter(Boolean))];
  await Promise.all(fileIds.map((publicId) => deleteFile(publicId)));

  await auditLog.removeForApplications(applicationIds);
  const interviewsDeleted = await interviewRepo.removeByApplications(applicationIds);
  const applicationsDeleted = await applicationRepo.removeMany(applicationIds);
  await candidateRepo.remove(candidate._id);

  logger.info(`[Candidate] Permanently deleted ${candidate._id}: applications=${applicationsDeleted}, interviews=${interviewsDeleted}, cloudinaryFiles=${fileIds.length}.`);
  res.json({
    message: 'Candidate and all related records were deleted.',
    deleted: { applications: applicationsDeleted, interviews: interviewsDeleted, cloudinaryFiles: fileIds.length },
  });
});

/** POST /api/candidates/send-onboarding-form */
const sendOnboardingForm = asyncHandler(async (req, res) => {
  const { candidateEmail, candidateName, onboardingUrl, applicationId } = req.body;
  if (!candidateEmail) {
    throw new ValidationError(['candidateEmail'], 'Candidate email is required.');
  }

  // Mark it pending BEFORE queueing, so the queue's later "sent" update cannot be overwritten.
  const hasApplication = applicationId && isValidId(applicationId);
  if (hasApplication) await applicationRepo.markOnboardingFormPending(applicationId);

  // The email is sent in the background; the queue marks the application "sent" once it really goes out.
  const result = await enqueueEmail({
    type: 'onboarding-form',
    to: candidateEmail,
    payload: { candidateEmail, candidateName, onboardingUrl },
    ...(hasApplication ? { related: { kind: 'onboarding-form', applicationId } } : {}),
  });

  res.json({
    queued: result.queued,
    emailReason: result.reason || null,
  });
});

/**
 * POST /api/candidates/bulk-attach
 * Attaches multiple candidates to a single requisition.
 * Skips candidates who are already attached to that requisition without throwing error.
 */
const bulkAttach = asyncHandler(async (req, res) => {
  const { candidateIds, requisitionId } = req.body;
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw new ValidationError(['candidateIds'], 'Select at least one candidate.');
  }
  if (!requisitionId) {
    throw new ValidationError(['requisitionId'], 'Requisition ID is required.');
  }

  const requisition = await requisitionRepo.findById(requisitionId);
  if (!requisition) throw new ValidationError(['requisitionId'], 'Job opening not found.');

  const candidates = await candidateRepo.findNamesByIds(candidateIds);
  if (candidates.length === 0) throw new ValidationError(['candidateIds'], 'No valid candidates found.');

  const existingCandidateIds = new Set(
    (await applicationRepo.listAttachedCandidateIds(candidates.map((c) => c._id), requisitionId)).map(String),
  );

  const enabledStages = (requisition.stages || []).filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const firstStageKey = enabledStages[0]?.key || null;

  const toCreate = [];
  let skippedCount = 0;

  candidates.forEach((c) => {
    if (existingCandidateIds.has(String(c._id))) {
      skippedCount += 1;
    } else {
      toCreate.push({
        candidateId: c._id,
        requisitionId,
        currentStageKey: firstStageKey,
        source: 'manual',
        stageProgress: enabledStages.map((s) => ({ stageKey: s.key, status: 'pending' })),
      });
    }
  });

  const created = toCreate.length > 0 ? await applicationRepo.createMany(toCreate) : [];

  logger.info(`[Candidate] Bulk attach to ${requisitionId}: attached=${created.length}, skipped=${skippedCount}.`);
  res.status(200).json({
    attachedCount: created.length,
    skippedCount,
    requisitionTitle: requisition.title,
    message: `Attached ${created.length} candidate${created.length === 1 ? '' : 's'} to "${requisition.title}"${skippedCount > 0 ? ` (${skippedCount} already attached and skipped)` : ''}.`,
  });
});

export { list, create, bulkCreate, bulkAttach, getOne, update, apply, removeFromRequisition, remove, sendOnboardingForm };


