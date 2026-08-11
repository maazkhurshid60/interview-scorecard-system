const crypto = require('crypto');
const Requisition = require('../models/Requisition');
const PipelineTemplate = require('../models/PipelineTemplate');
const Scorecard = require('../models/Scorecard');
const Application = require('../models/Application');
const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, normalizeWeights } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { generateScorecard } = require('../services/questionGenerator');
const { rankApplications } = require('../services/scoringEngine');

/** Reads a Setting's scalar value, falling back to a default if missing. */
async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key });
  return setting?.value ?? fallback;
}

/**
 * POST /api/requisitions
 * Creates a requisition, snapshotting the chosen pipeline template's stages
 * so later template edits never mutate an already-open requisition.
 */
const create = asyncHandler(async (req, res) => {
  const { title, jobDescription, pipelineTemplateId, hireThreshold, maybeThreshold } = req.body;

  if (!title || !jobDescription || !pipelineTemplateId) {
    throw new ValidationError(['title', 'jobDescription', 'pipelineTemplateId'], 'title, jobDescription, and pipelineTemplateId are required.');
  }

  const template = await PipelineTemplate.findById(pipelineTemplateId);
  if (!template) {
    throw new ValidationError(['pipelineTemplateId'], 'No pipeline template found with that id.');
  }

  const stages = template.stages.map((s) => ({
    key: s.key, label: s.label, stageType: s.stageType, inputType: s.inputType,
    enabled: s.enabled, order: s.order, weight: s.weight, passThreshold: s.passThreshold,
  }));

  const defaultHire = await getSettingValue('hireThreshold', 3.5);
  const defaultMaybe = await getSettingValue('maybeThreshold', 3.0);

  const requisition = await Requisition.create({
    title,
    jobDescription,
    pipelineTemplateId,
    stages,
    hireThreshold: hireThreshold ?? defaultHire,
    maybeThreshold: maybeThreshold ?? defaultMaybe,
    createdBy: req.user._id,
  });

  logger.info(`[Requisition] Created "${title}" (${requisition._id}) by user=${req.user._id}`);
  res.status(201).json({ requisition });
});

/**
 * GET /api/requisitions
 * Lists requisitions, optionally filtered by status (?status=open|on_hold|closed).
 *
 * Each row carries a candidate rollup (total, still in progress, and the
 * hire/maybe/no-hire split) so the list can answer "which roles are actually
 * moving?" without the client fetching every requisition's detail separately.
 */
const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const requisitions = await Requisition.find(filter).sort({ createdAt: -1 }).lean();

  const applications = await Application.find({ requisitionId: { $in: requisitions.map((r) => r._id) } })
    .select('requisitionId disposition')
    .lean();

  const statsByRequisition = new Map();
  applications.forEach((a) => {
    const key = String(a.requisitionId);
    if (!statsByRequisition.has(key)) {
      statsByRequisition.set(key, { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 });
    }
    const stats = statsByRequisition.get(key);
    stats.total += 1;
    if (a.disposition) stats[a.disposition] += 1;
    else stats.inProgress += 1;
  });

  res.json({
    requisitions: requisitions.map((r) => ({
      ...r,
      candidateStats: statsByRequisition.get(String(r._id))
        || { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 },
    })),
  });
});

/**
 * GET /api/requisitions/:id
 * Returns one requisition with its scorecard and current (persisted) ranking.
 */
const getOne = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });

  const scorecard = requisition.scorecardId ? await Scorecard.findById(requisition.scorecardId) : null;
  const applications = await Application.find({ requisitionId: requisition._id })
    .populate('candidateId', 'name email');

  applications.sort((a, b) => {
    if (a.rank === null || a.rank === undefined) return 1;
    if (b.rank === null || b.rank === undefined) return -1;
    return a.rank - b.rank;
  });

  res.json({ requisition, scorecard, applications });
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

  const { title, jobDescription, status, hireThreshold, maybeThreshold, weights } = req.body;

  if (title !== undefined) requisition.title = title;
  if (jobDescription !== undefined) requisition.jobDescription = jobDescription;
  if (hireThreshold !== undefined) requisition.hireThreshold = hireThreshold;
  if (maybeThreshold !== undefined) requisition.maybeThreshold = maybeThreshold;

  if (status !== undefined && status !== requisition.status) {
    requisition.status = status;
    if (status === 'closed') requisition.closedAt = new Date();
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

  await requisition.save();
  logger.info(`[Requisition] Updated ${requisition._id} by user=${req.user._id}`);
  res.json({ requisition });
});

/**
 * DELETE /api/requisitions/:id
 * Deletes the requisition document only — does not cascade-delete
 * candidates/applications/interviews/audit history, since those are
 * historical records the system is designed to never silently lose.
 */
const remove = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findByIdAndDelete(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  logger.info(`[Requisition] Deleted ${requisition._id} by user=${req.user._id}`);
  res.json({ message: 'Requisition deleted.' });
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

  const generated = await generateScorecard(requisition);
  generated.stages.forEach((stage) => {
    stage.attributes.forEach((attr, index) => {
      attr.attributeId = `${stage.stageKey}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
    });
  });

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

module.exports = {
  create, list, getOne, update, remove,
  generateScorecard: generateScorecardHandler,
  cloneScorecard,
  updateScorecard,
  ranking,
};
