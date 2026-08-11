const Candidate = require('../models/Candidate');
const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { uploadBuffer, destroyFile } = require('../config/cloudinary');

/**
 * GET /api/candidates — list all candidates, each with the requisitions it is
 * already attached to.
 *
 * The attachments are resolved here in two queries rather than left to the
 * client, which would otherwise need one request per requisition just to
 * answer "is this person already in a pipeline?" — and without that answer the
 * only way to find out is to attempt an attach and read the 409.
 */
const list = asyncHandler(async (req, res) => {
  const candidates = await Candidate.find().sort({ createdAt: -1 }).lean();

  const applications = await Application.find({ candidateId: { $in: candidates.map((c) => c._id) } })
    .select('candidateId requisitionId currentStageKey disposition')
    .lean();
  const requisitions = await Requisition.find({ _id: { $in: applications.map((a) => a.requisitionId) } })
    .select('title status')
    .lean();
  const requisitionById = new Map(requisitions.map((r) => [String(r._id), r]));

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
  });
});

/** POST /api/candidates — create a candidate; `resume` file field is optional (multer). */
const create = asyncHandler(async (req, res) => {
  const { name, email, phone, notes } = req.body;
  if (!name) throw new ValidationError(['name'], 'name is required.');

  let resumeFileUrl;
  let resumeFilePublicId;
  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, { folder: 'resumes', filename: `${Date.now()}-${req.file.originalname}` });
    resumeFileUrl = uploaded.secureUrl;
    resumeFilePublicId = uploaded.publicId;
  }

  const candidate = await Candidate.create({
    name,
    email,
    phone,
    notes,
    resumeFileUrl,
    resumeFilePublicId,
  });

  logger.info(`[Candidate] Created "${name}" (${candidate._id})${req.file ? ' with résumé' : ''}.`);
  res.status(201).json({ candidate });
});

/** GET /api/candidates/:id */
const getOne = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });
  res.json({ candidate });
});

/** PATCH /api/candidates/:id */
const update = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const { name, email, phone, notes } = req.body;
  if (name !== undefined) candidate.name = name;
  if (email !== undefined) candidate.email = email;
  if (phone !== undefined) candidate.phone = phone;
  if (notes !== undefined) candidate.notes = notes;

  if (req.file) {
    const oldPublicId = candidate.resumeFilePublicId;
    const uploaded = await uploadBuffer(req.file.buffer, { folder: 'resumes', filename: `${Date.now()}-${req.file.originalname}` });
    candidate.resumeFileUrl = uploaded.secureUrl;
    candidate.resumeFilePublicId = uploaded.publicId;
    if (oldPublicId) destroyFile(oldPublicId).catch((err) => logger.warn(`[Candidate] Could not delete old résumé ${oldPublicId}: ${err.message}`));
  }

  await candidate.save();
  res.json({ candidate });
});

/**
 * POST /api/candidates/:id/apply
 * Attaches a candidate to a requisition, creating the Application record
 * every score will attach to. Refuses to create a duplicate Application for
 * the same candidate+requisition pair.
 */
const apply = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const { requisitionId } = req.body;
  if (!requisitionId) throw new ValidationError(['requisitionId'], 'requisitionId is required.');

  const requisition = await Requisition.findById(requisitionId);
  if (!requisition) throw new ValidationError(['requisitionId'], 'No requisition found with that id.');

  const existing = await Application.findOne({ candidateId: candidate._id, requisitionId });
  if (existing) {
    return res.status(409).json({
      error: 'VALIDATION_ERROR',
      message: 'This candidate already has an application for this requisition.',
      applicationId: existing._id,
    });
  }

  const enabledStages = requisition.stages.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const firstStageKey = enabledStages[0]?.key || null;

  const application = await Application.create({
    candidateId: candidate._id,
    requisitionId,
    currentStageKey: firstStageKey,
    stageProgress: enabledStages.map((s) => ({ stageKey: s.key, status: 'pending' })),
  });

  logger.info(`[Candidate] ${candidate._id} applied to requisition ${requisitionId} -> application ${application._id}`);
  res.status(201).json({ application });
});

module.exports = { list, create, getOne, update, apply };
