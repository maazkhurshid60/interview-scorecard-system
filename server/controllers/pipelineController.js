const PipelineTemplate = require('../models/PipelineTemplate');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, normalizeWeights } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');

/**
 * Rebuilds the template's free-text description as a live summary of its
 * currently enabled, scored stages — e.g. "HR Screen (22%) -> Technical/Ops
 * (78%)." Runs on every stage/weight edit so it can never go stale the way a
 * write-once description would.
 */
function describeTemplateStages(stages) {
  const scored = stages
    .filter((s) => s.enabled && s.inputType !== 'pass_fail' && s.inputType !== 'status_only')
    .sort((a, b) => a.order - b.order);
  if (scored.length === 0) return 'No scored stages enabled.';

  // Rounding each stage's percentage independently can make the displayed
  // total 99% or 101% even when the true weights sum to 1 — largest-
  // remainder method guarantees the displayed percentages always sum to
  // exactly 100.
  const raw = scored.map((s) => s.weight * 100);
  const floors = raw.map(Math.floor);
  const remainder = 100 - floors.reduce((sum, v) => sum + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < remainder && n < order.length; n++) floors[order[n].i] += 1;

  return `${scored.map((s, i) => `${s.label} (${floors[i]}%)`).join(' -> ')}.`;
}

/** Re-normalizes the weights of a template's enabled, scored stages to sum to 1. */
function normalizeTemplateStages(stages) {
  const scoredKeys = stages
    .filter((s) => s.enabled && s.inputType !== 'pass_fail' && s.inputType !== 'status_only')
    .map((s) => s.key);
  const weights = {};
  scoredKeys.forEach((key) => { weights[key] = stages.find((s) => s.key === key).weight; });
  const normalized = normalizeWeights(weights);
  stages.forEach((s) => {
    if (normalized[s.key] !== undefined) s.weight = normalized[s.key];
  });
  return stages;
}

/** GET /api/pipelines — list all templates. */
const list = asyncHandler(async (req, res) => {
  const templates = await PipelineTemplate.find().sort({ name: 1 });
  res.json({ templates });
});

/** POST /api/pipelines — create a new template (weights auto-normalized). */
const create = asyncHandler(async (req, res) => {
  const { name, description, stages } = req.body;
  if (!name || !Array.isArray(stages) || stages.length === 0) {
    throw new ValidationError(['name', 'stages'], 'name and a non-empty stages array are required.');
  }
  const normalizedStages = normalizeTemplateStages(stages);
  const template = await PipelineTemplate.create({ name, description, stages: normalizedStages });
  logger.info(`[Pipeline] Created template "${name}" (${template._id}) by user=${req.user._id}`);
  res.status(201).json({ template });
});

/**
 * PATCH /api/pipelines/:id — update name/description/stages (toggle enabled,
 * reorder, edit weights). Weights are auto-normalized to 100% across
 * enabled, scored stages after any change, and toggles/weight edits are audited.
 */
const update = asyncHandler(async (req, res) => {
  const template = await PipelineTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ error: 'NOT_FOUND', message: 'Pipeline template not found.' });

  const { name, description, stages } = req.body;
  if (name !== undefined) template.name = name;
  if (description !== undefined) template.description = description;

  if (Array.isArray(stages)) {
    const oldEnabled = {};
    const oldWeights = {};
    template.stages.forEach((s) => { oldEnabled[s.key] = s.enabled; oldWeights[s.key] = s.weight; });

    template.stages = normalizeTemplateStages(stages);
    template.description = describeTemplateStages(template.stages);

    const enabledChanged = template.stages.some((s) => oldEnabled[s.key] !== undefined && oldEnabled[s.key] !== s.enabled);
    const weightsChanged = template.stages.some((s) => oldWeights[s.key] !== undefined && oldWeights[s.key] !== s.weight);

    if (enabledChanged) {
      await AuditLog.create({
        action: 'stage_toggle', userId: req.user._id, targetType: 'pipelineTemplate', targetId: template._id.toString(),
        oldValue: oldEnabled, newValue: Object.fromEntries(template.stages.map((s) => [s.key, s.enabled])),
        reason: 'Stage enabled/disabled via pipeline template edit.',
      });
    }
    if (weightsChanged) {
      await AuditLog.create({
        action: 'weight_change', userId: req.user._id, targetType: 'pipelineTemplate', targetId: template._id.toString(),
        oldValue: oldWeights, newValue: Object.fromEntries(template.stages.map((s) => [s.key, s.weight])),
        reason: 'Stage weights re-normalized via pipeline template edit.',
      });
    }
  }

  await template.save();
  logger.info(`[Pipeline] Updated template ${template._id} by user=${req.user._id}`);
  res.json({ template });
});

/** PUT /api/pipelines/:id/default — flags this template as the default (unsets all others). */
const setDefault = asyncHandler(async (req, res) => {
  const template = await PipelineTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ error: 'NOT_FOUND', message: 'Pipeline template not found.' });

  await PipelineTemplate.updateMany({ _id: { $ne: template._id } }, { $set: { isDefault: false } });
  template.isDefault = true;
  await template.save();

  logger.info(`[Pipeline] Set ${template._id} ("${template.name}") as the default template.`);
  res.json({ template });
});

/** DELETE /api/pipelines/:id — refuses to delete the current default (set another default first). */
const remove = asyncHandler(async (req, res) => {
  const template = await PipelineTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ error: 'NOT_FOUND', message: 'Pipeline template not found.' });
  if (template.isDefault) {
    throw new ValidationError(['isDefault'], 'Cannot delete the default template — set another template as default first.');
  }
  await PipelineTemplate.findByIdAndDelete(req.params.id);
  logger.info(`[Pipeline] Deleted template ${req.params.id} by user=${req.user._id}`);
  res.json({ message: 'Pipeline template deleted.' });
});

module.exports = { list, create, update, setDefault, remove };
