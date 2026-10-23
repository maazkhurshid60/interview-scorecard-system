const crypto = require('crypto');
const mongoose = require('mongoose');
const Requisition = require('../models/Requisition');
const PipelineTemplate = require('../models/PipelineTemplate');
const Scorecard = require('../models/Scorecard');
const Application = require('../models/Application');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const transcriptProvider = require('../services/transcriptProvider');
const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, normalizeWeights } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { assertRequisitionOpen, assertRequisitionConfigurable } = require('../utils/requisitionStatus');
const { generateScorecard } = require('../services/questionGenerator');
const { syncHrQuestionnaireRubric, assignMissingAttributeIds } = require('../utils/scorecardHelpers');
const { rankApplications } = require('../services/scoringEngine');
const { enqueueApplication } = require('../services/applicationProcessor');
const { uploadFile, deleteFile } = require('../services/fileStorage');
const { assertPdfUpload } = require('../utils/uploadValidation');
const { cleanRichText } = require('../utils/sanitizeRichText');
const { callClaude, getModelIds } = require('../services/claudeClient');
const { getCaptchaConfig, verifyCaptcha } = require('../services/captchaService');
const { destroyFileIfUnreferenced } = require('../services/fileReferenceCleanup');
// Server-side validation mirror. The editable UI definition lives in client/src/constants.
const screeningCriteriaConfig = {
  education: { label: 'Education', options: ["Bachelor's degree", "Master's degree", 'PhD'] },
  experience: { label: 'Experience', options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'] },
};

const PHONE_NUMBER_PATTERN = /^\d{11}$/;
const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'];
const JOB_TITLE_MIN_LENGTH = 5;

/** Office locations are configured as a pipe-separated environment variable. */
function getRegisteredOfficeLocations() {
  return (process.env.REGISTERED_OFFICE_LOCATIONS || '')
    .split('|')
    .map((location) => location.trim())
    .filter(Boolean);
}

/** Builds the structured and display location values for a requisition. */
function resolveWorkplace({ workplaceType, officeLocation, remoteRegion }, current = {}) {
  const type = workplaceType ?? current.workplaceType ?? 'remote';
  if (!WORKPLACE_TYPES.includes(type)) {
    throw new ValidationError(['workplaceType'], 'Work arrangement must be onsite, hybrid, or remote.');
  }

  const offices = getRegisteredOfficeLocations();
  const selectedOffice = String(officeLocation ?? current.officeLocation ?? '').trim();
  const selectedRegion = String(remoteRegion ?? current.remoteRegion ?? '').trim();

  if (type === 'onsite') {
    const primaryOffice = offices[0];
    if (!primaryOffice) {
      throw new ValidationError(
        ['officeLocation'],
        'A registered office location must be configured before creating an onsite requisition.'
      );
    }
    return {
      workplaceType: type,
      officeLocation: primaryOffice,
      remoteRegion: '',
      location: `Onsite — ${primaryOffice}`,
    };
  }

  if (type === 'hybrid') {
    if (!offices.length) {
      throw new ValidationError(
        ['officeLocation'],
        'A registered office location must be configured before creating a hybrid requisition.'
      );
    }
    if (!selectedOffice) {
      throw new ValidationError(['officeLocation'], 'Please select an office location for a hybrid requisition.');
    }
    if (!offices.includes(selectedOffice)) {
      throw new ValidationError(['officeLocation'], 'Please select a registered office location for a hybrid requisition.');
    }
    return {
      workplaceType: type,
      officeLocation: selectedOffice,
      remoteRegion: '',
      location: `Hybrid — ${selectedOffice}`,
    };
  }

  return {
    workplaceType: type,
    officeLocation: '',
    remoteRegion: selectedRegion,
    location: selectedRegion ? `Remote — ${selectedRegion}` : 'Remote',
  };
}

const EMPLOYMENT_DETAIL_FIELDS = {
  full_time: 'fullTimeDetails',
  part_time: 'partTimeDetails',
  contract: 'contractDetails',
  internship: 'internshipDetails',
  temporary: 'temporaryDetails',
};

function normalizeEmploymentDetails(employmentType, raw) {
  const details = raw && typeof raw === 'object' ? raw : {};
  if (employmentType === 'full_time') {
    return { workingHours: String(details.workingHours || '').trim() };
  }
  if (employmentType === 'part_time') {
    return {
      weeklyHours: String(details.weeklyHours || '').trim(),
      workingHours: String(details.workingHours || '').trim(),
    };
  }
  if (employmentType === 'contract') {
    return {
      duration: String(details.duration || '').trim(),
      workingHours: String(details.workingHours || '').trim(),
      paymentRate: String(details.paymentRate || '').trim(),
    };
  }
  if (employmentType === 'internship') {
    return {
      duration: String(details.duration || '').trim(),
      paidStatus: String(details.paidStatus ?? 'paid').trim(),
      workingHours: String(details.workingHours || '').trim(),
    };
  }
  return {
    startDate: details.startDate ? new Date(details.startDate) : null,
    endDate: details.endDate ? new Date(details.endDate) : null,
    workingHours: String(details.workingHours || '').trim(),
  };
}

function validateEmploymentDetails(employmentType, details, missingFields) {
  if (employmentType === 'full_time') {
    if (!details.workingHours) missingFields.push('full-time working hours');
    return;
  }
  if (employmentType === 'part_time') {
    if (!details.weeklyHours) missingFields.push('part-time weekly hours');
    if (!details.workingHours) missingFields.push('part-time working hours');
    return;
  }
  if (employmentType === 'contract') {
    if (!details.duration) missingFields.push('contract duration');
    if (!details.workingHours) missingFields.push('contract working hours');
    if (!details.paymentRate) missingFields.push('contract payment/rate');
    return;
  }
  if (employmentType === 'internship') {
    if (!details.duration) missingFields.push('internship duration');
    if (!['paid', 'unpaid'].includes(details.paidStatus)) missingFields.push('internship paid status (paid or unpaid)');
    if (!details.workingHours) missingFields.push('internship working hours');
    return;
  }
  if (!details.startDate || Number.isNaN(details.startDate.getTime())) missingFields.push('temporary role start date');
  if (!details.endDate || Number.isNaN(details.endDate.getTime())) missingFields.push('temporary role end date');
  if (details.startDate && details.endDate && details.endDate < details.startDate) {
    missingFields.push('temporary end date (must be after start date)');
  }
  if (!details.workingHours) missingFields.push('temporary role working hours');
}

function normalizeJobTitle(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new ValidationError(['title'], 'Job title is required and cannot be blank.');
  }
  const normalizedTitle = title.replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ').trim();
  if (!normalizedTitle) {
    throw new ValidationError(['title'], 'Job title is required and cannot be blank.');
  }
  if (normalizedTitle.length < JOB_TITLE_MIN_LENGTH) {
    throw new ValidationError(['title'], `Job title must be at least ${JOB_TITLE_MIN_LENGTH} characters.`);
  }
  return normalizedTitle;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reads a Setting's scalar value, falling back to a default if missing. */
async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key });
  return setting?.value ?? fallback;
}

/** Normalizes raw questionnaire inputs into objects { question, idealAnswer, requireIdealAnswer }. */
function normalizeQuestionnaire(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') {
        return { question: item.trim(), idealAnswer: '', requireIdealAnswer: false };
      }
      if (typeof item === 'object' && item !== null) {
        return {
          question: (item.question || '').trim(),
          idealAnswer: (item.idealAnswer || '').trim(),
          requireIdealAnswer: Boolean(item.requireIdealAnswer),
        };
      }
      return null;
    }).filter((item) => item && item.question);
  }
  if (typeof raw === 'string') {
    return raw.split('\n').map((q) => q.trim()).filter(Boolean).map((q) => ({
      question: q,
      idealAnswer: '',
      requireIdealAnswer: false,
    }));
  }
  return [];
}

function parseTimeToMinutes(t) {
  if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime12h(t) {
  if (!t || typeof t !== 'string' || !t.includes(':')) return t || '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${period}`;
}

/** Normalizes HR interview availability window. */
function normalizeInterviewAvailability(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const startDate = raw.startDate ? new Date(raw.startDate) : null;
  const endDate = raw.endDate ? new Date(raw.endDate) : null;
  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return undefined;
  }
  return {
    startDate,
    endDate,
    startTime: raw.startTime ? String(raw.startTime).trim() : '10:00',
    endTime: raw.endTime ? String(raw.endTime).trim() : '17:00',
    timezone: raw.timezone ? String(raw.timezone).trim() : 'UTC',
    notes: raw.notes ? String(raw.notes).trim() : '',
  };
}


/** Normalizes the two supported, structured screening criteria. */
function normalizeInitialScreeningCriteria(raw) {
  const items = Array.isArray(raw) ? raw : [];
  const experience = items.find((item) => String(item?.criteria || '').toLowerCase() === 'experience') || {};
  const educationInput = items.find((item) => String(item?.criteria || '').toLowerCase() === 'education') || {};
  const education = screeningCriteriaConfig.education;
  const educationMinimum = String(educationInput.minimumValue || '').trim();
  const educationMaximum = String(educationInput.maximumValue || '').trim();
  const relevantField = String(educationInput.relevantField || '').trim();
  const allowVirtualUniversityOngoing = Boolean(
    educationInput.allowVirtualUniversityOngoing || items.some((i) => i?.allowVirtualUniversityOngoing)
  );
  const minimumValue = String(experience.minimumValue || '').trim();
  const maximumValue = String(experience.maximumValue || '').trim();

  let educationReq = relevantField && educationMinimum && educationMaximum ? `${educationMinimum} to ${educationMaximum} in ${relevantField}` : '';
  if (allowVirtualUniversityOngoing) {
    educationReq += (educationReq ? ' | ' : '') + 'Allow ongoing/in-progress degree for Virtual University / Distance Learning';
  }

  return [
    {
      criteria: education.label,
      minimumValue: educationMinimum,
      maximumValue: educationMaximum,
      relevantField,
      allowVirtualUniversityOngoing,
      requirement: educationReq,
    },
    {
      criteria: screeningCriteriaConfig.experience.label,
      minimumValue,
      maximumValue,
      requirement: minimumValue && maximumValue ? `Minimum: ${minimumValue} years; Maximum: ${maximumValue} years` : '',
    },
  ];
}

function validateInitialScreeningCriteria(criteria, missingFields) {
  const education = criteria.find((criterion) => criterion.criteria === screeningCriteriaConfig.education.label);
  if (!education?.relevantField) missingFields.push('education relevant field or major');
  if (!education?.minimumValue || !education?.maximumValue) {
    missingFields.push('education minimum and maximum qualification');
  } else {
    const options = screeningCriteriaConfig.education.options;
    if (!options.includes(education.minimumValue) || !options.includes(education.maximumValue)) {
      missingFields.push('valid education minimum and maximum qualification');
    } else if (options.indexOf(education.minimumValue) > options.indexOf(education.maximumValue)) {
      missingFields.push('education maximum qualification must be equal to or higher than the minimum qualification');
    }
  }
  const experience = criteria.find((criterion) => criterion.criteria === screeningCriteriaConfig.experience.label);
  if (!experience?.minimumValue || !experience?.maximumValue) {
    missingFields.push('experience minimum and maximum values');
    return;
  }
  const options = screeningCriteriaConfig.experience.options;
  if (!options.includes(experience.minimumValue) || !options.includes(experience.maximumValue)) {
    missingFields.push('valid experience minimum and maximum values');
    return;
  }
  const minimumIndex = options.indexOf(experience.minimumValue);
  const maximumIndex = options.indexOf(experience.maximumValue);
  if (minimumIndex > maximumIndex) missingFields.push('experience maximum value must be equal to or greater than the minimum value');
}

/** A date-only application deadline remains open through the whole UTC day. */
function hasApplicationDeadlinePassed(deadline) {
  if (!deadline) return false;
  const date = new Date(deadline);
  const nextDayStartUtc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  );
  return Date.now() >= nextDayStartUtc;
}

/**
 * POST /api/requisitions
 * Creates a requisition, snapshotting the chosen pipeline template's stages
 * so later template edits never mutate an already-open requisition.
 */
const create = asyncHandler(async (req, res) => {
  const {
    title, employmentType, fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails,
    workplaceType, officeLocation, remoteRegion, jobDescription: rawJobDescription, pipelineTemplateId, hireThreshold, maybeThreshold,
    initialScreeningCriteria, questionnaire, interviewAvailability, applicationDeadline, aiScreeningEnabled, status, departmentId,
  } = req.body;
  // The description is rich text shown to candidates and staff: only the formatting the editor produces is kept.
  const jobDescription = cleanRichText(rawJobDescription);

  const missingFields = [];
  if (typeof title !== 'string' || !title.trim()) missingFields.push('title');
  if (!employmentType) missingFields.push('employmentType');

  const employmentDetailInputs = { fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails };
  const employmentDetailField = EMPLOYMENT_DETAIL_FIELDS[employmentType];
  const normalizedEmploymentDetails = normalizeEmploymentDetails(employmentType, employmentDetailInputs[employmentDetailField]);
  if (employmentDetailField) validateEmploymentDetails(employmentType, normalizedEmploymentDetails, missingFields);

  if (!workplaceType) missingFields.push('workplaceType');
  if (!jobDescription || !jobDescription.trim()) missingFields.push('jobDescription');

  const normalizedCriteria = normalizeInitialScreeningCriteria(initialScreeningCriteria);
  validateInitialScreeningCriteria(normalizedCriteria, missingFields);

  const normalizedQuestions = normalizeQuestionnaire(questionnaire);
  if (normalizedQuestions.length === 0) {
    missingFields.push('questionnaire');
  } else {
    for (let i = 0; i < normalizedQuestions.length; i++) {
      const q = normalizedQuestions[i];
      if (!q.question) {
        missingFields.push(`questionnaire item #${i + 1} (question text)`);
      } else if (q.requireIdealAnswer && !q.idealAnswer) {
        missingFields.push(`questionnaire item #${i + 1} ideal answer benchmark`);
      }
    }
  }

  if (!applicationDeadline) missingFields.push('applicationDeadline');
  if (!pipelineTemplateId) missingFields.push('pipelineTemplateId');

  if (missingFields.length > 0) {
    throw new ValidationError(missingFields, `Please fill out all required fields: ${missingFields.join(', ')}.`);
  }
  if (status !== undefined && !['open', 'paused', 'closed', 'draft'].includes(status)) {
    throw new ValidationError(['status'], 'status must be open, paused, closed, or draft.');
  }
  const normalizedTitle = normalizeJobTitle(title);
  const workplace = resolveWorkplace({ workplaceType, officeLocation, remoteRegion });

  const duplicateActiveOpening = await Requisition.findOne({
    title: { $regex: `^${escapeRegex(normalizedTitle)}$`, $options: 'i' },
    status: 'open',
  }).select('_id title').lean();

  const template = await PipelineTemplate.findById(pipelineTemplateId);
  if (!template) {
    throw new ValidationError(['pipelineTemplateId'], 'No hiring process template found with that id.');
  }
  const pipelineTemplateName = template.name;

  const stages = template.stages.map((s) => ({
    key: s.key, label: s.label, stageType: s.stageType, inputType: s.inputType,
    enabled: s.enabled, order: s.order, weight: s.weight, passThreshold: s.passThreshold,
  }));

  const defaultHire = await getSettingValue('hireThreshold', 3.5);
  const defaultMaybe = await getSettingValue('maybeThreshold', 3.0);

  const normalizedInterviewAvailability = normalizeInterviewAvailability(interviewAvailability);
  if (normalizedInterviewAvailability) {
    if (normalizedInterviewAvailability.endDate < normalizedInterviewAvailability.startDate) {
      throw new ValidationError(['interviewAvailability.endDate'], 'Interview availability end date cannot be earlier than start date.');
    }
    if (parseTimeToMinutes(normalizedInterviewAvailability.endTime) <= parseTimeToMinutes(normalizedInterviewAvailability.startTime)) {
      throw new ValidationError(['interviewAvailability.endTime'], 'Interview availability end time must be after start time.');
    }
  }

  const requisition = await Requisition.create({
    title: normalizedTitle,
    employmentType: employmentType || 'full_time',
    ...(employmentDetailField ? { [employmentDetailField]: normalizedEmploymentDetails } : {}),
    ...workplace,
    jobDescription,
    pipelineTemplateId,
    pipelineTemplateName,
    stages,
    hireThreshold: hireThreshold ?? defaultHire,
    maybeThreshold: maybeThreshold ?? defaultMaybe,
    initialScreeningCriteria: normalizeInitialScreeningCriteria(initialScreeningCriteria),
    questionnaire: normalizeQuestionnaire(questionnaire),
    interviewAvailability: normalizedInterviewAvailability,
    applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
    aiScreeningEnabled: aiScreeningEnabled !== undefined ? Boolean(aiScreeningEnabled) : true,
    status: status || 'open',
    departmentId: departmentId && mongoose.isValidObjectId(departmentId) ? departmentId : undefined,
    closedAt: status === 'closed' ? new Date() : undefined,
    createdBy: req.user._id,
  });

  logger.info(`[Requisition] Created "${normalizedTitle}" (${requisition._id}) by user=${req.user._id}`);
  res.status(201).json({
    requisition,
    warning: duplicateActiveOpening
      ? `A job opening named "${duplicateActiveOpening.title}" already exists.`
      : undefined,
  });
});

/**
 * GET /api/requisitions
 * Lists requisitions, optionally filtered by status (?status=open|paused|closed|draft).
 *
 * Each row carries a candidate rollup (total, still in progress, and the
 * hire/maybe/no-hire split) so the list can answer "which roles are actually
 * moving?" without the client fetching every requisition's detail separately.
 */
const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    // Include legacy `on_hold` records in the new Paused filter.
    filter.status = req.query.status === 'paused' ? { $in: ['paused', 'on_hold'] } : req.query.status;
  }
  if (req.query.departmentId && req.query.departmentId !== 'all') {
    filter.departmentId = req.query.departmentId;
  }
  const requisitions = await Requisition.find(filter)
    .populate('departmentId', 'name')
    .sort({ createdAt: -1 })
    .lean();

  // The database counts the applications per job and disposition, so only a few small rows come back,
  // instead of loading every application just to count them in JavaScript.
  const counts = await Application.aggregate([
    { $match: { requisitionId: { $in: requisitions.map((r) => r._id) } } },
    { $group: { _id: { requisitionId: '$requisitionId', disposition: '$disposition' }, count: { $sum: 1 } } },
  ]);

  const statsByRequisition = new Map();
  counts.forEach(({ _id, count }) => {
    const key = String(_id.requisitionId);
    if (!statsByRequisition.has(key)) {
      statsByRequisition.set(key, { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 });
    }
    const stats = statsByRequisition.get(key);
    stats.total += count;
    // No disposition yet (null, missing or empty) means the candidate is still in progress.
    if (_id.disposition && stats[_id.disposition] !== undefined) stats[_id.disposition] += count;
    else stats.inProgress += count;
  });

  res.json({
    registeredOfficeLocations: getRegisteredOfficeLocations(),
    requisitions: requisitions.map((r) => ({
      ...r,
      status: r.status === 'on_hold' ? 'paused' : r.status,
      candidateStats: statsByRequisition.get(String(r._id))
        || { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 },
    })),
  });
});

/**
 * GET /api/requisitions/:id
 * Returns one requisition with its scorecard and server-paginated applications.
 * Supports ?page=1&limit=10&search=john&disposition=HIRE|MAYBE|NO_HIRE|in_progress&finalDecision=hired|rejected|withdrawn|undecided&stageKey=...&candidateId=...
 */
const getOne = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id)
    .populate('departmentId', 'name description');
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job Opening not found.' });

  // The scorecard is loaded separately when its tab is opened.
  const scorecard = null;

  const query = { requisitionId: requisition._id };

  if (req.query.disposition) {
    const dispositions = String(req.query.disposition).split(',').filter(Boolean);
    if (dispositions.includes('none')) {
      query._id = { $in: [] };
    } else if (!dispositions.includes('all')) {
      const includeInProgress = dispositions.includes('in_progress');
      const scoredDispositions = dispositions.filter((value) => ['HIRE', 'MAYBE', 'NO_HIRE'].includes(value));
      if (includeInProgress && scoredDispositions.length) {
        query.$or = [{ disposition: null }, { disposition: { $in: scoredDispositions } }];
      } else if (includeInProgress) {
        query.disposition = null;
      } else {
        query.disposition = { $in: scoredDispositions };
      }
    }
  }

  if (req.query.finalDecision) {
    const decisions = String(req.query.finalDecision).split(',').filter(Boolean);
    if (decisions.includes('none')) {
      query._id = { $in: [] };
    } else if (!decisions.includes('all')) {
      const includeUndecided = decisions.includes('undecided');
      const recordedDecisions = decisions.filter((value) => ['hired', 'rejected', 'withdrawn'].includes(value));
      if (includeUndecided && recordedDecisions.length) {
        query.finalDecision = { $in: [null, ...recordedDecisions] };
      } else if (includeUndecided) {
        query.finalDecision = null;
      } else {
        query.finalDecision = { $in: recordedDecisions };
      }
    }
  }

  if (req.query.candidateId) {
    // This query is later used in an aggregation pipeline, which unlike a
    // Mongoose find() query does not cast URL strings to ObjectIds for us.
    query.candidateId = mongoose.isValidObjectId(req.query.candidateId)
      ? new mongoose.Types.ObjectId(req.query.candidateId)
      : { $in: [] };
  }

  if (req.query.stageKey && req.query.stageKey !== 'all') {
    query.currentStageKey = req.query.stageKey;
  }

  if (req.query.search && req.query.search.trim()) {
    const searchRegex = new RegExp(escapeRegex(req.query.search.trim()), 'i');
    const matchingCandidates = await Candidate.find({
      $or: [{ name: searchRegex }, { email: searchRegex }],
    }).select('_id').lean();

    const candidateIds = matchingCandidates.map((c) => c._id);
    if (query.candidateId) {
      const targetCid = String(query.candidateId);
      query.candidateId = { $in: candidateIds.filter((cid) => String(cid) === targetCid) };
    } else {
      query.candidateId = { $in: candidateIds };
    }
  }

  const totalApplications = await Application.countDocuments(query);
  const dispositionCounts = await Application.aggregate([
    { $match: { requisitionId: requisition._id } },
    { $group: { _id: '$disposition', count: { $sum: 1 } } },
  ]);
  const applicationStats = { total: 0, IN_PROGRESS: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 };
  dispositionCounts.forEach(({ _id: disposition, count }) => {
    if (disposition && applicationStats[disposition] !== undefined) applicationStats[disposition] = count;
    else applicationStats.IN_PROGRESS += count;
    applicationStats.total += count;
  });
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const totalPages = Math.max(1, Math.ceil(totalApplications / limit));
  const requestedPage = Math.max(1, parseInt(req.query.page, 10) || 1);
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  // Put ranked applications first. A normal MongoDB ascending sort places
  // null/missing ranks before rank 1, which is not the ranking shown in the UI.
  const applications = await Application.aggregate([
    { $match: query },
    {
      $addFields: {
        _rankSort: {
          $cond: [{ $ne: [{ $ifNull: ['$rank', null] }, null] }, 0, 1],
        },
      },
    },
    { $sort: { _rankSort: 1, rank: 1, weightedTotal: -1, createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _rankSort: 0 } },
  ]);
  await Application.populate(applications, { path: 'candidateId', select: 'name email phone' });

  const requisitionResponse = requisition.toObject();
  if (requisitionResponse.status === 'on_hold') requisitionResponse.status = 'paused';

  res.json({
    requisition: requisitionResponse,
    scorecard,
    applications,
    applicationStats,
    pagination: {
      total: totalApplications,
      page,
      limit,
      totalPages,
    },
  });
});

/**
 * PATCH /api/requisitions/:id
 * Updates title/JD/status/thresholds/stage weights. Closing a requisition
 * stamps closedAt (drives the retention purge). Weight edits are
 * auto-normalized to sum to 1 across enabled, scored stages and audited.
 */
const update = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });

  const {
    title, employmentType, fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails,
    location, workplaceType, officeLocation, remoteRegion, jobDescription, status, hireThreshold, maybeThreshold, weights,
    initialScreeningCriteria, questionnaire, interviewAvailability, applicationDeadline, aiScreeningEnabled, departmentId, pipelineTemplateId,
  } = req.body;

  const hasNonStatusChanges = [
    title, employmentType, fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails,
    location, workplaceType, officeLocation, remoteRegion, jobDescription, hireThreshold, maybeThreshold,
    weights, initialScreeningCriteria, questionnaire, interviewAvailability, applicationDeadline, aiScreeningEnabled, departmentId, pipelineTemplateId,
  ].some((value) => value !== undefined);
  if (requisition.status === 'closed' && (status !== 'open' || hasNonStatusChanges)) {
    const error = new ValidationError(['status'], 'This requisition is closed and read-only. Reopen it before making changes.');
    error.statusCode = 409;
    throw error;
  }
  if (status !== undefined && !['open', 'paused', 'closed', 'draft'].includes(status)) {
    throw new ValidationError(['status'], 'status must be open, paused, closed, or draft.');
  }

  if (title !== undefined) requisition.title = normalizeJobTitle(title);
  if (pipelineTemplateId !== undefined && mongoose.isValidObjectId(pipelineTemplateId)) {
    const template = await PipelineTemplate.findById(pipelineTemplateId);
    if (template) {
      requisition.pipelineTemplateId = template._id;
      requisition.pipelineTemplateName = template.name;
    }
  }
  if (employmentType !== undefined) requisition.employmentType = employmentType;
  const employmentDetailInputs = { fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails };
  const hasEmploymentDetailsChanges = Object.values(employmentDetailInputs).some((value) => value !== undefined);
  if (employmentType !== undefined || hasEmploymentDetailsChanges) {
    const nextEmploymentType = employmentType ?? requisition.employmentType;
    const employmentDetailField = EMPLOYMENT_DETAIL_FIELDS[nextEmploymentType];
    if (employmentDetailField) {
      const details = normalizeEmploymentDetails(
        nextEmploymentType,
        employmentDetailInputs[employmentDetailField] ?? requisition[employmentDetailField]
      );
      const missingFields = [];
      validateEmploymentDetails(nextEmploymentType, details, missingFields);
      if (missingFields.length) {
        throw new ValidationError(missingFields, `Please fill out all required fields: ${missingFields.join(', ')}.`);
      }
      Object.values(EMPLOYMENT_DETAIL_FIELDS).forEach((field) => { requisition[field] = undefined; });
      requisition[employmentDetailField] = details;
    }
  }
  const hasWorkplaceChanges = [workplaceType, officeLocation, remoteRegion].some((value) => value !== undefined);
  if (hasWorkplaceChanges) {
    Object.assign(requisition, resolveWorkplace({ workplaceType, officeLocation, remoteRegion }, requisition));
  } else if (location !== undefined) {
    // Keeps older API clients working while the UI uses structured workplace fields.
    requisition.location = location;
  }
  if (jobDescription !== undefined) requisition.jobDescription = cleanRichText(jobDescription);
  if (hireThreshold !== undefined) requisition.hireThreshold = hireThreshold;
  if (maybeThreshold !== undefined) requisition.maybeThreshold = maybeThreshold;
  if (initialScreeningCriteria !== undefined) {
    const criteria = normalizeInitialScreeningCriteria(initialScreeningCriteria);
    const missingFields = [];
    validateInitialScreeningCriteria(criteria, missingFields);
    if (missingFields.length) throw new ValidationError(missingFields, `Please correct: ${missingFields.join(', ')}.`);
    requisition.initialScreeningCriteria = criteria;
  }
  if (questionnaire !== undefined) {
    requisition.questionnaire = normalizeQuestionnaire(questionnaire);
    if (requisition.scorecardId) {
      try {
        const scorecard = await Scorecard.findById(requisition.scorecardId);
        if (scorecard && syncHrQuestionnaireRubric(scorecard, requisition)) {
          await scorecard.save();
        }
      } catch (scErr) {
        logger.warn(`[Requisition] Questionnaire scorecard sync error: ${scErr.message}`);
      }
    }
  }
  if (interviewAvailability !== undefined) {
    if (interviewAvailability === null || interviewAvailability === '') {
      requisition.interviewAvailability = undefined;
    } else {
      const normalized = normalizeInterviewAvailability(interviewAvailability);
      if (normalized) {
        if (normalized.endDate < normalized.startDate) {
          throw new ValidationError(['interviewAvailability.endDate'], 'Interview availability end date cannot be earlier than start date.');
        }
        if (parseTimeToMinutes(normalized.endTime) <= parseTimeToMinutes(normalized.startTime)) {
          throw new ValidationError(['interviewAvailability.endTime'], 'Interview availability end time must be after start time.');
        }
      }
      requisition.interviewAvailability = normalized;
    }
  }
  if (applicationDeadline !== undefined) requisition.applicationDeadline = applicationDeadline ? new Date(applicationDeadline) : null;
  if (aiScreeningEnabled !== undefined) requisition.aiScreeningEnabled = Boolean(aiScreeningEnabled);
  if (departmentId !== undefined) {
    requisition.departmentId = departmentId && mongoose.isValidObjectId(departmentId) ? departmentId : null;
  }

  let statusChange = null;
  if (status !== undefined && status !== requisition.status) {
    const oldStatus = requisition.status;
    requisition.status = status;
    if (status === 'closed') requisition.closedAt = new Date();
    if (status !== 'closed') requisition.closedAt = undefined;
    statusChange = { oldStatus, newStatus: status };
  }

  if (weights && typeof weights === 'object') {
    const oldWeights = {};
    requisition.stages.forEach((s) => { oldWeights[s.key] = s.weight; });

    const scoredKeys = requisition.stages
      .filter((s) => s.enabled && s.inputType !== 'pass_fail' && s.inputType !== 'status_only')
      .map((s) => s.key);
    const merged = {};
    scoredKeys.forEach((key) => { merged[key] = weights[key] !== undefined ? Number(weights[key]) : oldWeights[key]; });
    const normalized = normalizeWeights(merged);

    requisition.stages.forEach((s) => {
      if (normalized[s.key] !== undefined) s.weight = normalized[s.key];
    });

    await AuditLog.create({
      action: 'weight_change', userId: req.user._id, requisitionId: requisition._id,
      targetType: 'requisition', targetId: requisition._id.toString(),
      oldValue: oldWeights, newValue: normalized, reason: 'Stage weights updated via requisition edit.',
    });
  }

  const effectiveStatus = requisition.status;
  let duplicateActiveOpening = null;
  if (effectiveStatus === 'open') {
    duplicateActiveOpening = await Requisition.findOne({
      _id: { $ne: requisition._id },
      title: { $regex: `^${escapeRegex(requisition.title)}$`, $options: 'i' },
      status: 'open',
    }).select('_id title').lean();
  }

  await requisition.save();
  if (statusChange) {
    await AuditLog.create({
      action: 'requisition_status_change', userId: req.user._id, requisitionId: requisition._id,
      targetType: 'requisition', targetId: requisition._id.toString(),
      oldValue: statusChange.oldStatus, newValue: statusChange.newStatus,
      reason: `Requisition status changed from ${statusChange.oldStatus} to ${statusChange.newStatus}.`,
    });
  }
  logger.info(`[Requisition] Updated ${requisition._id} by user=${req.user._id}`);
  res.json({
    requisition,
    warning: duplicateActiveOpening
      ? `A job opening named "${duplicateActiveOpening.title}" already exists.`
      : undefined,
  });
});

/**
 * DELETE /api/requisitions/:id
 * Permanently deletes the requisition and cleans up all related records:
 * - Cancels all active scheduled Google Calendar meetings (notifying attendees).
 * - Cleans up attached Cloudinary artifact/evidence files.
 * - Deletes associated Scorecard, Applications, and Interview records.
 * - Records audit log entry.
 */
const remove = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job Opening not found.' });

  // Find all applications & interviews for this requisition
  const applications = await Application.find({ requisitionId: requisition._id }).select('_id offerLetterPublicId').lean();
  const interviews = await Interview.find({ requisitionId: requisition._id });

  // 1. Cancel all scheduled Google Calendar meetings for all interviews in this requisition
  const cancellations = await Promise.allSettled(
    interviews.filter((interview) => interview.calendarEventId).map((interview) => transcriptProvider.cancelMeeting(interview))
  );
  if (cancellations.some((result) => result.status === 'rejected')) {
    const error = new Error('Could not cancel all scheduled Calendar meetings. The Job Opening was not deleted. Please try again.');
    error.statusCode = 502;
    throw error;
  }

  // 2. Collect & clean up any uploaded Cloudinary artifact/evidence files
  const artifactIds = [...new Set(
    interviews.map((interview) => interview.artifactFilePublicId).filter(Boolean)
  )];

  // 3. Delete database records (Scorecard, Interviews, Applications, Audit Logs)
  if (requisition.scorecardId) {
    await Scorecard.findByIdAndDelete(requisition.scorecardId);
  }
  await Scorecard.deleteMany({ requisitionId: requisition._id });
  const interviewResult = await Interview.deleteMany({ requisitionId: requisition._id });
  const applicationResult = await Application.deleteMany({ requisitionId: requisition._id });
  await AuditLog.deleteMany({ requisitionId: requisition._id });

  // 4. Clean up stored files (interview artifacts, and each application's offer letter)
  const offerLetterIds = [...new Set(applications.map((application) => application.offerLetterPublicId).filter(Boolean))];
  const cleanupResults = await Promise.allSettled([
    ...artifactIds.map(destroyFileIfUnreferenced),
    ...offerLetterIds.map((publicId) => deleteFile(publicId).then(() => true)),
  ]);
  const deletedFiles = cleanupResults.filter((result) => result.status === 'fulfilled' && result.value).length;
  cleanupResults
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.warn(`[Requisition] Could not delete a stored file while deleting "${requisition.title}": ${result.reason?.message || result.reason}`));

  // 5. Delete the requisition itself
  const reqTitle = requisition.title;
  await requisition.deleteOne();

  await AuditLog.create({
    action: 'requisition_deleted',
    userId: req.user._id,
    targetType: 'requisition',
    targetId: req.params.id,
    reason: `Deleted Job Opening "${reqTitle}" (${req.params.id}) and all attached records.`,
  });

  logger.info(`[Requisition] Permanently deleted "${reqTitle}" (${req.params.id}): applications=${applicationResult.deletedCount}, interviews=${interviewResult.deletedCount}, files=${deletedFiles} by user=${req.user._id}`);

  res.json({
    message: `Job Opening "${reqTitle}" and all related data deleted cleanly.`,
    deleted: {
      applications: applicationResult.deletedCount,
      interviews: interviewResult.deletedCount,
      files: deletedFiles,
    },
  });
});

/**
 * POST /api/requisitions/:id/duplicate
 * Duplicates a job opening (requisition) without copying candidates or applications.
 * Copies all metadata, employment details, job description, workplace, hiring process stages,
 * screening criteria, questionnaire, and clones the scorecard if present.
 */
const duplicate = asyncHandler(async (req, res) => {
  const sourceReq = await Requisition.findById(req.params.id);
  if (!sourceReq) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Job Opening not found.' });
  }

  const newTitle = normalizeJobTitle(sourceReq.title);

  const duplicateActiveOpening = await Requisition.findOne({
    title: { $regex: `^${escapeRegex(newTitle)}$`, $options: 'i' },
    status: 'open',
  }).select('_id title').lean();

  const sourceData = sourceReq.toObject();
  delete sourceData._id;
  delete sourceData.createdAt;
  delete sourceData.updatedAt;
  delete sourceData.closedAt;
  delete sourceData.scorecardId;

  const newReqData = {
    ...sourceData,
    title: newTitle,
    status: 'draft',
    createdBy: req.user._id,
  };

  const newReq = await Requisition.create(newReqData);

  // Clone scorecard if original had one
  if (sourceReq.scorecardId) {
    const sourceScorecard = await Scorecard.findById(sourceReq.scorecardId);
    if (sourceScorecard) {
      const scorecardData = sourceScorecard.toObject();
      delete scorecardData._id;
      delete scorecardData.createdAt;
      delete scorecardData.updatedAt;
      scorecardData.requisitionId = newReq._id;

      if (Array.isArray(scorecardData.stages)) {
        assignMissingAttributeIds(scorecardData.stages);
      }

      const newScorecard = await Scorecard.create(scorecardData);
      newReq.scorecardId = newScorecard._id;
      await newReq.save();
    }
  }

  await AuditLog.create({
    action: 'requisition_duplicated',
    userId: req.user._id,
    requisitionId: newReq._id,
    targetType: 'requisition',
    targetId: newReq._id.toString(),
    reason: `Duplicated from Job Opening "${sourceReq.title}" (${sourceReq._id}).`,
  });

  logger.info(`[Requisition] Duplicated "${sourceReq.title}" (${sourceReq._id}) -> "${newReq.title}" (${newReq._id}) by user=${req.user._id}`);

  res.status(201).json({
    requisition: newReq,
    message: 'Job Opening duplicated successfully.',
    warning: duplicateActiveOpening
      ? `A job opening named "${duplicateActiveOpening.title}" already exists.`
      : undefined,
  });
});

/**
 * POST /api/requisitions/:id/generate-scorecard
 * Calls questionGenerator to produce a role-specific rubric from the JD,
 * assigns a stable attributeId to each attribute, and saves/updates the
 * Scorecard (regenerating replaces the existing one, since HR may want a
 * fresh pass — already-scored interviews keep referencing their attributeIds
 * by value, so past scores are unaffected unless the same id is reused).
 */
const generateScorecardHandler = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionConfigurable(requisition, 'generate a scorecard');

  const generated = await generateScorecard(requisition);
  assignMissingAttributeIds(generated.stages);

  let scorecard;
  if (requisition.scorecardId) {
    scorecard = await Scorecard.findById(requisition.scorecardId);
  }
  if (scorecard) {
    scorecard.stages = generated.stages;
    scorecard.generatedByAI = true;
    await scorecard.save();
  } else {
    scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: true, stages: generated.stages });
    requisition.scorecardId = scorecard._id;
    await requisition.save();
  }

  logger.info(`[Requisition] Generated scorecard for ${requisition._id} (${generated.stages.length} stages).`);
  res.json({ scorecard });
});

/**
 * POST /api/requisitions/:id/clone-scorecard
 * Body: { sourceRequisitionId }. Copies another requisition's scorecard
 * stages/attributes verbatim onto this requisition (marked generatedByAI:false).
 */
const cloneScorecard = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionConfigurable(requisition, 'edit the scorecard');

  const { sourceRequisitionId } = req.body;
  if (!sourceRequisitionId) throw new ValidationError(['sourceRequisitionId'], 'sourceRequisitionId is required.');

  const sourceRequisition = await Requisition.findById(sourceRequisitionId);
  if (!sourceRequisition || !sourceRequisition.scorecardId) {
    throw new ValidationError(['sourceRequisitionId'], 'Source requisition has no scorecard to clone.');
  }
  const sourceScorecard = await Scorecard.findById(sourceRequisition.scorecardId);
  if (!sourceScorecard) throw new ValidationError(['sourceRequisitionId'], 'Source scorecard not found.');

  let scorecard;
  if (requisition.scorecardId) {
    scorecard = await Scorecard.findById(requisition.scorecardId);
    scorecard.stages = sourceScorecard.stages;
    scorecard.generatedByAI = false;
    await scorecard.save();
  } else {
    scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: false, stages: sourceScorecard.stages });
    requisition.scorecardId = scorecard._id;
    await requisition.save();
  }

  logger.info(`[Requisition] Cloned scorecard from ${sourceRequisitionId} onto ${requisition._id}.`);
  res.json({ scorecard });
});

/**
 * PATCH /api/requisitions/:id/scorecard
 * Persists manual edits made in ScorecardEditor: attribute text changes,
 * and added/removed attributes. Newly-added attributes (no attributeId
 * yet) get one assigned server-side, same scheme as generate-scorecard.
 * Not in INSTRUCTIONS.md's original route table — added because the
 * frontend spec explicitly requires ScorecardEditor to "save" edits, and
 * generate-scorecard/clone-scorecard only ever overwrite from AI/another
 * requisition, never persist arbitrary manual edits.
 */
const updateScorecard = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionConfigurable(requisition, 'edit the scorecard');
  if (!requisition.scorecardId) {
    throw new ValidationError(['scorecardId'], 'This requisition has no scorecard yet — generate one first.');
  }

  const { stages } = req.body;
  if (!Array.isArray(stages)) {
    throw new ValidationError(['stages'], 'stages must be an array.');
  }

  const scorecard = await Scorecard.findById(requisition.scorecardId);
  const oldStages = scorecard.stages;

  stages.forEach((stage) => {
    stage.attributes.forEach((attr, index) => {
      if (!attr.attributeId) {
        attr.attributeId = `${stage.stageKey}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
      }
    });
  });

  scorecard.stages = stages;
  await scorecard.save();

  await AuditLog.create({
    action: 'question_edit', userId: req.user._id, requisitionId: requisition._id,
    targetType: 'scorecard', targetId: scorecard._id.toString(),
    oldValue: oldStages, newValue: scorecard.stages, reason: 'Scorecard manually edited via ScorecardEditor.',
  });

  logger.info(`[Requisition] Scorecard manually updated for ${requisition._id}.`);
  res.json({ scorecard });
});

/**
 * GET /api/requisitions/:id/ranking
 * Returns the persisted ranking (weightedTotal/disposition/rank) for every
 * application under this requisition. These values are computed and
 * persisted by scoringController.recompute — this endpoint just reads them.
 */
const ranking = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });

  const applications = await Application.find({ requisitionId: requisition._id }).populate('candidateId', 'name email');
  const ranked = rankApplications(applications.map((a) => a.toObject()));
  ranked.sort((a, b) => {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });

  res.json({ ranking: ranked });
});

/** GET /api/requisitions/:id/scorecard — lazy scorecard data for the detail tab. */
const getScorecard = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id).select('scorecardId');
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job Opening not found.' });
  const scorecard = requisition.scorecardId ? await Scorecard.findById(requisition.scorecardId) : null;
  res.json({ scorecard });
});

/**
 * POST /api/requisitions/generate-field
 * Uses Anthropic Claude AI to auto-generate content for jobDescription,
 * initialScreeningCriteria, or questionnaire based on title and optional prompt context.
 */
const generateField = asyncHandler(async (req, res) => {
  const { fieldType, title, jobDescription, prompt: userPromptText } = req.body;
  if (!fieldType || !title) {
    throw new ValidationError(['fieldType', 'title'], 'fieldType and title are required.');
  }
  if (fieldType === 'initialScreeningCriteria') {
    throw new ValidationError(['fieldType'], 'Initial screening criteria are fixed and cannot be generated with AI.');
  }

  const modelIds = await getModelIds();
  const cheapModel = modelIds.cheap;

  let systemPrompt = '';
  let userPrompt = '';
  let expectJson = false;

  if (fieldType === 'jobDescription') {
    systemPrompt = 'You are an expert HR recruiter creating comprehensive, professional Job Descriptions formatted cleanly using HTML (headings <h3>, bulleted lists <ul><li>, and paragraphs <p>).';
    userPrompt = `Generate a detailed, professional Job Description for the position: "${title}". ${userPromptText ? `Additional instructions/context: ${userPromptText}` : ''}
Output clean HTML content using <h3> sections (e.g. <h3>About the Role</h3>, <h3>Key Responsibilities</h3>, <h3>Qualifications & Requirements</h3>), <p> paragraphs, <ul> and <li> bullet points, and <strong> text. Do NOT wrap in markdown code fence.`;
  } else if (fieldType === 'initialScreeningCriteria') {
    expectJson = true;
    systemPrompt = 'You are an expert HR Screener defining clear, objective initial screening criteria categories and detailed requirements extracted directly from the Job Description.';
    userPrompt = `Based on the following Job Description for "${title}", generate 4 to 6 specific initial screening criteria categories (e.g., Experience, Portfolio/Reel, Software Proficiency, Education, Availability, Key Competencies) and their exact requirements.

Job Description:
${jobDescription || title}
${userPromptText ? `Additional instructions: ${userPromptText}\n` : ''}
Respond ONLY in JSON format matching this exact shape:
{
  "criteriaList": [
    { "criteria": "Experience", "requirement": "1–2 years in video editing (agency, in-house, or freelance)" },
    { "criteria": "Portfolio/Reel", "requirement": "Must submit a demo reel or portfolio link" },
    { "criteria": "Software Proficiency", "requirement": "Adobe Premiere Pro (required), After Effects (preferred)" },
    { "criteria": "Education", "requirement": "Bachelor's degree or equivalent practical experience" },
    { "criteria": "Availability", "requirement": "Immediate joiner preferred / notice period acceptable" }
  ]
}`;
  } else if (fieldType === 'questionnaire') {
    expectJson = true;
    systemPrompt = 'You are an expert HR recruiter generating relevant application questionnaire questions and 5-star scoring benchmarks derived directly from the Job Description.';
    userPrompt = `Based on the following Job Description for "${title}", generate 4 to 6 relevant application questionnaire questions for candidates, along with target ideal answers (5-star benchmarks).

Job Description:
${jobDescription || title}
${userPromptText ? `Additional instructions: ${userPromptText}\n` : ''}
Respond ONLY in JSON format matching this exact shape:
{
  "questions": [
    {
      "question": "Question text...",
      "idealAnswer": "Ideal 5-star benchmark answer..."
    }
  ]
}`;
  } else {
    throw new ValidationError(['fieldType'], 'Invalid fieldType specified.');
  }

  const result = await callClaude({
    model: cheapModel,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    expectJson,
  });

  if (expectJson) {
    const parsed = JSON.parse(result.text);
    if (fieldType === 'initialScreeningCriteria') {
      return res.json({ criteria: normalizeInitialScreeningCriteria(parsed.criteriaList || parsed.criteria || parsed.items) });
    }
    return res.json({ questions: normalizeQuestionnaire(parsed.questions) });
  }

  res.json({ content: result.text.trim() });
});

/**
 * GET /api/requisitions/:id/public
 * Public endpoint returning open requisition details for candidates.
 */
const getPublic = asyncHandler(async (req, res) => {
  logger.info(`[Requisition] Public GET request for ID: "${req.params.id}"`);

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    logger.warn(`[Requisition] Public GET failed: "${req.params.id}" is not a valid ObjectId`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  const requisition = await Requisition.findById(req.params.id)
    .select('title employmentType fullTimeDetails partTimeDetails contractDetails internshipDetails temporaryDetails location workplaceType officeLocation remoteRegion jobDescription initialScreeningCriteria questionnaire applicationDeadline aiScreeningEnabled status createdAt interviewAvailability')
    .lean();

  if (!requisition) {
    logger.warn(`[Requisition] Public GET failed: Requisition "${req.params.id}" not found in database`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  if (requisition.status !== 'open') {
    logger.warn(`[Requisition] Public GET failed: Requisition "${req.params.id}" status is "${requisition.status}" (must be "open")`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  const isExpired = hasApplicationDeadlinePassed(requisition.applicationDeadline);

  logger.info(`[Requisition] Public GET success: Found open requisition "${requisition.title}" (${requisition._id})`);

  res.json({
    requisition: {
      ...requisition,
      isExpired,
    },
    captcha: (() => {
      const { enabled, siteKey } = getCaptchaConfig();
      return { enabled, siteKey: enabled ? siteKey : undefined };
    })(),
  });
});

/**
 * POST /api/requisitions/:id/apply
 * Public endpoint for candidate self-application submission with resume upload.
 */
const applyPublic = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'This position is closed or no longer accepting applications.' });
  }

  const requisition = await Requisition.findById(req.params.id);
  if (!requisition || requisition.status !== 'open') {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'This position is closed or no longer accepting applications.' });
  }

  if (hasApplicationDeadlinePassed(requisition.applicationDeadline)) {
    return res.status(400).json({ error: 'EXPIRED', message: 'The application deadline for this position has passed.' });
  }

  const captchaResult = await verifyCaptcha(req.body?.captchaToken, req.ip);
  if (!captchaResult.valid) {
    return res.status(400).json({
      error: 'CAPTCHA_FAILED',
      message: 'Please complete the security check and submit your application again.',
    });
  }

  const { name, email, phone, questionnaireAnswers, opportunityDuration, candidateAvailability } = req.body;
  if (!name || !email) {
    throw new ValidationError(['name', 'email'], 'Name and email are required to apply.');
  }
  if (!PHONE_NUMBER_PATTERN.test(String(phone || '').trim())) {
    throw new ValidationError(['phone'], 'Phone number must contain exactly 11 digits.');
  }

  let parsedCandidateAvailability = null;
  if (candidateAvailability) {
    if (typeof candidateAvailability === 'string') {
      try { parsedCandidateAvailability = JSON.parse(candidateAvailability); } catch (e) { parsedCandidateAvailability = null; }
    } else if (typeof candidateAvailability === 'object') {
      parsedCandidateAvailability = candidateAvailability;
    }
  }

  const hrAvail = requisition.interviewAvailability;
  if (hrAvail && hrAvail.startDate && hrAvail.endDate) {
    if (!parsedCandidateAvailability || !parsedCandidateAvailability.preferredDate) {
      throw new ValidationError(['candidateAvailability'], 'Please select your interview availability.');
    }

    const prefDate = String(parsedCandidateAvailability.preferredDate).trim();
    const hrStartStr = new Date(hrAvail.startDate).toISOString().slice(0, 10);
    const hrEndStr = new Date(hrAvail.endDate).toISOString().slice(0, 10);

    if (prefDate < hrStartStr || prefDate > hrEndStr) {
      throw new ValidationError(['candidateAvailability.preferredDate'], `Preferred interview date must be between ${hrStartStr} and ${hrEndStr}.`);
    }

    const prefStartTime = String(parsedCandidateAvailability.startTime || '').trim();
    const prefEndTime = String(parsedCandidateAvailability.endTime || '').trim();
    const hrStartTime = hrAvail.startTime || '10:00';
    const hrEndTime = hrAvail.endTime || '17:00';

    if (!prefStartTime || !prefEndTime) {
      throw new ValidationError(['candidateAvailability.time'], 'Please select preferred interview start and end times.');
    }

    if (parseTimeToMinutes(prefEndTime) <= parseTimeToMinutes(prefStartTime)) {
      throw new ValidationError(['candidateAvailability.endTime'], 'Interview end time must be after start time.');
    }

    if (parseTimeToMinutes(prefStartTime) < parseTimeToMinutes(hrStartTime) || parseTimeToMinutes(prefEndTime) > parseTimeToMinutes(hrEndTime)) {
      throw new ValidationError(
        ['candidateAvailability.time'],
        `Preferred interview time must be within the available window (${formatTime12h(hrStartTime)} – ${formatTime12h(hrEndTime)}).`
      );
    }
  }

  let parsedQAnswers = {};
  if (typeof questionnaireAnswers === 'string') {
    try { parsedQAnswers = JSON.parse(questionnaireAnswers); } catch (e) { parsedQAnswers = {}; }
  } else if (typeof questionnaireAnswers === 'object' && questionnaireAnswers !== null) {
    parsedQAnswers = questionnaireAnswers;
  }
  const unansweredQuestions = (requisition.questionnaire || []).filter((question) => {
    const questionText = typeof question === 'string' ? question : question.question;
    return !String(parsedQAnswers[questionText] || '').trim();
  });
  if (unansweredQuestions.length > 0) {
    throw new ValidationError(['questionnaireAnswers'], 'Please answer every screening question before submitting your application.');
  }
  assertPdfUpload(req.file, { field: 'resume', label: 'resume' });

  const cleanEmail = email.toLowerCase().trim();

  // 1. Check if candidate already exists AND has an application for this requisition BEFORE uploading to Cloudinary
  let candidate = await Candidate.findOne({ email: cleanEmail });
  if (candidate) {
    const existingApp = await Application.findOne({ candidateId: candidate._id, requisitionId: requisition._id });
    if (existingApp) {
      return res.status(409).json({ error: 'DUPLICATE', message: 'You have already submitted an application for this position.' });
    }
  }

  // 2. Upload file to Cloudinary & extract text ONLY after verifying non-duplicate status
  let resumeFileUrl = '';
  let resumeFilePublicId = '';
  let candidateResumeFileUrl = '';
  let candidateResumeFilePublicId = '';
  let resumeMeta = null; // { name, size, mimeType } stored beside the file
  let oldProfileResumeId = null;
  let resumeText = '';

  if (req.file) {
    const uploaded = await uploadFile({ file: req.file, folder: 'candidate-resumes' });
    resumeFileUrl = uploaded.url;
    resumeFilePublicId = uploaded.publicId;
    resumeMeta = { name: uploaded.name, size: uploaded.size, mimeType: uploaded.mimeType };

    // The candidate profile keeps a current CV, while this application keeps
    // its own immutable resume-screen artifact for historical review.
    const profileUpload = await uploadFile({ file: req.file, folder: 'candidate-resumes', filenamePrefix: 'profile-' });
    candidateResumeFileUrl = profileUpload.url;
    candidateResumeFilePublicId = profileUpload.publicId;

    try {
      const { extractArtifactText } = require('../utils/textExtractor');
      resumeText = await extractArtifactText(req.file.buffer, req.file.originalname);
    } catch (err) {
      logger.warn(`[ApplyPublic] Text extraction failed for file ${req.file.originalname}: ${err.message}`);
    }
  }

  // 3. Create or update candidate record with the new CV upload
  if (!candidate) {
    candidate = await Candidate.create({
      name,
      email: cleanEmail,
      phone: phone.trim(),
      resumeFileUrl: candidateResumeFileUrl,
      resumeFilePublicId: candidateResumeFilePublicId,
      resumeFileName: resumeMeta?.name,
      resumeFileSize: resumeMeta?.size,
      resumeFileMimeType: resumeMeta?.mimeType,
    });
  } else {
    if (candidateResumeFileUrl) {
      oldProfileResumeId = candidate.resumeFilePublicId;
      candidate.resumeFileUrl = candidateResumeFileUrl;
      candidate.resumeFilePublicId = candidateResumeFilePublicId;
      candidate.resumeFileName = resumeMeta?.name;
      candidate.resumeFileSize = resumeMeta?.size;
      candidate.resumeFileMimeType = resumeMeta?.mimeType;
    }
    candidate.phone = phone.trim();
    await candidate.save();
    if (oldProfileResumeId) {
      destroyFileIfUnreferenced(oldProfileResumeId)
        .catch((err) => logger.warn(`[ApplyPublic] Could not clean up old candidate résumé ${oldProfileResumeId}: ${err.message}`));
    }
  }

  // 1. Create the Application document. Its AI screening is marked pending and
  //    done in the background (services/applicationProcessor.js) so the candidate
  //    gets their answer straight away instead of waiting for the AI.
  const enabledStages = (requisition.stages || []).filter((s) => s.enabled);
  // Public applications always begin with the required résumé screen, even
  // for a requisition created from an older pipeline template.
  const firstStage = enabledStages.find((stage) => stage.key === 'resume_screen')
    || enabledStages[0]
    || requisition.stages[0];
  const firstStageKey = firstStage ? firstStage.key : null;
  const hrStage = enabledStages.find((stage) => stage.key === 'hr_screen');

  const stageProgress = (requisition.stages || []).map((s) => ({
    stageKey: s.key,
    status: 'pending',
    stageAverage: null,
    passed: null,
  }));

  const candidateAvailPayload = parsedCandidateAvailability ? {
    preferredDate: String(parsedCandidateAvailability.preferredDate).trim(),
    startTime: String(parsedCandidateAvailability.startTime).trim(),
    endTime: String(parsedCandidateAvailability.endTime).trim(),
    notes: String(parsedCandidateAvailability.notes || '').trim(),
    submittedAt: new Date(),
  } : undefined;

  const application = await Application.create({
    candidateId: candidate._id,
    requisitionId: requisition._id,
    currentStageKey: firstStageKey,
    source: 'public_link',
    stageProgress,
    questionnaireAnswers: parsedQAnswers,
    opportunityDuration: opportunityDuration ? String(opportunityDuration).trim() : undefined,
    candidateAvailability: candidateAvailPayload,
    screeningJob: { status: 'pending' },
  });

  // 2. Create the stage interviews (just saves the résumé / answers; scoring happens later).
  const Interview = require('../models/Interview');
  if (firstStageKey) {
    await Interview.create({
      applicationId: application._id,
      requisitionId: requisition._id,
      stageKey: firstStageKey,
      meetingMode: 'online',
      provider: 'google_meet',
      status: 'pending',
      artifactFileUrl: resumeFileUrl,
      artifactFilePublicId: resumeFilePublicId,
      artifactFileName: resumeMeta?.name,
      artifactFileSize: resumeMeta?.size,
      artifactFileMimeType: resumeMeta?.mimeType,
      transcriptText: resumeText,
    });

    const progressItem = application.stageProgress.find((p) => p.stageKey === firstStageKey);
    if (progressItem) {
      progressItem.status = 'scheduled';
    }
  }

  // The HR questionnaire screen is created for every public application,
  // even when the résumé screen later fails its gate. It is a separate
  // automated evaluation and never includes the candidate's CV.
  if (hrStage && hrStage.key !== firstStageKey) {
    const questionnaireTranscript = (requisition.questionnaire || []).map((question, index) => {
      const questionText = typeof question === 'string' ? question : question.question;
      return `Question ${index + 1}: ${questionText}\nCandidate Answer: ${parsedQAnswers[questionText] || ''}`;
    }).join('\n\n');
    await Interview.create({
      applicationId: application._id,
      requisitionId: requisition._id,
      stageKey: hrStage.key,
      meetingMode: 'online',
      provider: 'google_meet',
      status: 'pending',
      transcriptText: questionnaireTranscript,
    });
    const hrProgress = application.stageProgress.find((progress) => progress.stageKey === hrStage.key);
    if (hrProgress) hrProgress.status = 'scheduled';
  }
  await application.save();

  logger.info(`[ApplyPublic] Application ${application._id} submitted for candidate "${name}" (${candidate._id}) on requisition "${requisition.title}"; AI screening queued.`);

  // Answer the candidate now. Nothing the candidate needs depends on the AI.
  res.status(201).json({
    success: true,
    message: 'Application submitted successfully! Your application is under review.',
    aiScreeningEnabled: requisition.aiScreeningEnabled,
  });

  // 3. Everything slow (scorecard, AI scoring, ranking, confirmation email) runs in the background.
  enqueueApplication(application._id);
});

module.exports = {
  create, list, getOne, getScorecard, update, remove, duplicate,
  generateScorecard: generateScorecardHandler,
  cloneScorecard,
  updateScorecard,
  ranking,
  generateField,
  getPublic,
  applyPublic,
};
