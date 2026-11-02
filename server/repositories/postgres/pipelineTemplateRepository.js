import { prisma } from './client.js';
import { castBoolean, castId, castNumber, castString, compareBytes, dateParam, idOut, jsonParam, newId, nullSet, sameJson, translateError, validationError } from './helpers.js';
import { nullsExpr } from './records.js';

/**
 * Everything the app needs from the database about hiring process templates, on PostgreSQL. It offers exactly the
 * functions of ../mongo/pipelineTemplateRepository.js and answers the same way, including the checks the Mongoose model
 * made on a template and its stages. The stages are a JSON list, written with raw SQL as text (Prisma would round
 * numbers that need 17 digits).
 */

const STAGE_TYPES = ['resume_screen', 'hr_screen', 'hr_interview', 'task_performance', 'technical', 'simulation', 'final', 'client', 'culture', 'reference', 'background', 'offer'];
const INPUT_TYPES = ['transcript', 'artifact', 'pass_fail', 'status_only', 'manual_rubric'];
const MODEL = 'PipelineTemplate';

const hasValue = (value) => value !== null && value !== undefined;

/** A stage as the Mongoose model hands it out: a stage stored without `enabled`, `weight` or `passThreshold` gets the defaults. */
const withStageDefaults = (stage) => ({
  ...stage,
  enabled: stage.enabled === undefined ? true : stage.enabled,
  weight: stage.weight === undefined ? 0 : stage.weight,
  passThreshold: stage.passThreshold === undefined ? 3.0 : stage.passThreshold,
});

/** A template row as the app has always seen it. An empty description is left out, as MongoDB left it out. */
const toTemplate = (row) => ({
  _id: idOut(row.id),
  name: row.name,
  ...(hasValue(row.description) ? { description: row.description } : (nullSet(row).has('description') ? { description: null } : {})),
  isDefault: row.isDefault,
  autoWeights: row.autoWeights,
  stages: (Array.isArray(row.stages) ? row.stages : []).map(withStageDefaults),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const required = (field) => `Path \`${field}\` is required.`;
const notAllowed = (value, field) => `\`${value}\` is not a valid enum value for path \`${field}\`.`;

/**
 * Casts and checks a list of stages the way the Mongoose model does. Problems are added to `problems`
 * (`{ 'stages.0.key': message }`) in the order Mongoose reports them: values it cannot read first, then the rest.
 */
function buildStages(stages, problems) {
  const list = Array.isArray(stages) ? stages : (stages === undefined || stages === null ? [] : [stages]);
  const casting = {}; const checking = {};
  const result = list.map((raw, i) => {
    const at = (field) => `stages.${i}.${field}`;
    if (!raw || typeof raw !== 'object') { casting[`stages.${i}`] = 'Cast to Embedded failed'; return null; }
    const take = (cast, field) => {
      const done = cast(raw[field], field); // the message names the field; the problem list names its place in the template
      if (done.problem) casting[at(field)] = done.problem;
      return done.value;
    };
    const stage = {
      key: take(castString, 'key'), label: take(castString, 'label'), stageType: take(castString, 'stageType'), inputType: take(castString, 'inputType'),
      enabled: take(castBoolean, 'enabled'), order: take(castNumber, 'order'), weight: take(castNumber, 'weight'), passThreshold: take(castNumber, 'passThreshold'),
    };
    if (stage.enabled === undefined) stage.enabled = true;
    if (stage.weight === undefined) stage.weight = 0;
    if (stage.passThreshold === undefined) stage.passThreshold = 3.0;

    // Mongoose reports a stage's missing values starting with its last field, then the values that are not allowed in field order
    const missing = (field) => !casting[at(field)] && (!hasValue(stage[field]) || stage[field] === '');
    for (const field of ['order', 'inputType', 'stageType', 'label', 'key']) if (missing(field)) checking[at(field)] = required(field);
    for (const [field, allowed] of [['stageType', STAGE_TYPES], ['inputType', INPUT_TYPES]]) {
      if (!casting[at(field)] && !missing(field) && !allowed.includes(stage[field])) checking[at(field)] = notAllowed(stage[field], field);
    }
    if (!casting[at('passThreshold')] && hasValue(stage.passThreshold)) {
      if (stage.passThreshold < 1) checking[at('passThreshold')] = `Path \`passThreshold\` (${stage.passThreshold}) is less than minimum allowed value (1).`;
      else if (stage.passThreshold > 5) checking[at('passThreshold')] = `Path \`passThreshold\` (${stage.passThreshold}) is more than maximum allowed value (5).`;
    }
    return stage;
  });
  Object.assign(problems, casting);
  return { stages: result, checking };
}

/** The checked values of the fields given (all of them for a new template), or the ValidationError Mongoose would throw. */
function build(input, { creating }) {
  const casting = {}; const checking = {}; const values = {};
  const take = (cast, field) => {
    const done = cast(input[field], field);
    if (done.problem) casting[field] = done.problem;
    return done.value;
  };
  if (creating || input.name !== undefined) {
    values.name = take(castString, 'name');
    if (!casting.name && (!hasValue(values.name) || values.name === '')) checking.name = required('name');
  }
  if (creating ? input.description !== undefined : input.description !== undefined) values.description = take(castString, 'description');
  if (input.isDefault !== undefined) values.isDefault = take(castBoolean, 'isDefault');
  if (input.autoWeights !== undefined) values.autoWeights = take(castBoolean, 'autoWeights');
  if (input.stages !== undefined || creating) {
    const built = buildStages(input.stages, casting);
    values.stages = built.stages;
    Object.assign(checking, built.checking);
  }
  const problems = { ...casting, ...checking };
  if (Object.keys(problems).length) throw validationError(MODEL, problems);
  return values;
}

/** All templates, sorted by name (byte order, as MongoDB sorts). */
export async function listAll() {
  const rows = await prisma.pipelineTemplate.findMany();
  return rows.sort((a, b) => compareBytes(a.name, b.name)).map(toTemplate);
}

/** One template, or null when there is none with that id. */
export async function findById(id) {
  const row = await prisma.pipelineTemplate.findUnique({ where: { id: castId(id, '_id') } });
  return row ? toTemplate(row) : null;
}

/** The template flagged as the default, or null. */
export async function findDefault() {
  const row = await prisma.pipelineTemplate.findFirst({ where: { isDefault: true }, orderBy: { id: 'asc' } });
  return row ? toTemplate(row) : null;
}

/** Creates a template and returns it. */
export async function create({ name, description, stages, autoWeights, isDefault } = {}) {
  const values = build({ name, description, stages, autoWeights, isDefault }, { creating: true });
  const now = dateParam(new Date());
  let id;
  try {
    [{ id }] = await prisma.$queryRawUnsafe(
      `INSERT INTO pipeline_templates (id, name, description, "isDefault", "autoWeights", stages, "createdAt", "updatedAt", "nullFields")
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::text::timestamp, $7::text::timestamp, $8::jsonb) RETURNING id`,
      newId(), values.name, values.description ?? null, values.isDefault ?? false, values.autoWeights ?? true, jsonParam(values.stages), now, values.description === null ? JSON.stringify(['description']) : null,
    );
  } catch (error) {
    throw translateError(error, { name: values.name }, ['name']);
  }
  return findById(id);
}

/**
 * Changes the given fields of a template (name, description, stages, autoWeights; fields left out stay as they are)
 * and returns the saved template, or null when it does not exist. Nothing is written when nothing changes.
 */
export async function update(id, changes = {}) {
  const row = await prisma.pipelineTemplate.findUnique({ where: { id: castId(id, '_id') } });
  if (!row) return null;
  const current = toTemplate(row);
  const given = {};
  for (const field of ['name', 'description', 'autoWeights', 'stages']) if (changes[field] !== undefined) given[field] = changes[field];
  const values = build(given, { creating: false });

  const sets = []; const params = [row.id];
  for (const field of ['name', 'description', 'autoWeights', 'stages']) {
    if (!(field in values) || sameJson(values[field], current[field])) continue;
    params.push(field === 'stages' ? jsonParam(values[field]) : (values[field] ?? null));
    sets.push(`"${field}" = $${params.length}${field === 'stages' ? '::jsonb' : ''}`);
    if (field === 'description') sets.push(`"nullFields" = ${nullsExpr(values.description === null ? { add: ['description'] } : { remove: ['description'] })}`);
  }
  if (!sets.length) return current;
  params.push(dateParam(new Date()));
  try {
    await prisma.$executeRawUnsafe(`UPDATE pipeline_templates SET ${sets.join(', ')}, "updatedAt" = $${params.length}::text::timestamp WHERE id = $1::uuid`, ...params);
  } catch (error) {
    throw translateError(error, { name: values.name }, ['name']);
  }
  return findById(row.id);
}

/** Makes this template the one default (every other template stops being the default). Null when it does not exist. */
export async function makeDefault(id) {
  const templateId = castId(id, '_id');
  const found = await prisma.$transaction(async (tx) => {
    const row = await tx.pipelineTemplate.findUnique({ where: { id: templateId } });
    if (!row) return false;
    const now = dateParam(new Date());
    // as MongoDB did: every other template is updated (and so gets a new update time), then this one if it was not the default yet
    await tx.$executeRawUnsafe(`UPDATE pipeline_templates SET "isDefault" = false, "updatedAt" = $2::text::timestamp WHERE id <> $1::uuid`, templateId, now);
    if (!row.isDefault) await tx.$executeRawUnsafe(`UPDATE pipeline_templates SET "isDefault" = true, "updatedAt" = $2::text::timestamp WHERE id = $1::uuid`, templateId, now);
    return true;
  });
  return found ? findById(templateId) : null;
}

/** Deletes a template. */
export async function remove(id) {
  await prisma.pipelineTemplate.deleteMany({ where: { id: castId(id, '_id') } });
}
