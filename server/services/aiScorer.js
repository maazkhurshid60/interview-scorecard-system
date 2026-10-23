const Application = require('../models/Application');
const Setting = require('../models/Setting');
const logger = require('../utils/logger');
const { callClaude, getModelIds } = require('./claudeClient');
const { STAGE_MODEL_TIER } = require('../utils/constants');

/** Below this word count, a transcript is treated as empty/noise — never scored. */
const MIN_TRANSCRIPT_WORDS = 30;

const SYSTEM_PROMPT = `You are scoring one candidate interview transcript against a fixed rubric for a single hiring stage. This is decision-support for a human recruiter, not a final verdict — score strictly against the anchors given, never on vibes.

For EACH attribute provided, return exactly one object: { "attributeId": "...", "score": <1-5 integer>, "justification": "<short, cites what was actually said in the transcript>" }.

Score 5 only when the transcript shows behavior matching that attribute's "what a 5 looks like" description. Score 1-2 when the transcript shows behavior matching that attribute's red-flag description. Use 3-4 for everything in between.

Respond ONLY with a valid JSON array, no other text, no markdown fences, no preamble:
[ { "attributeId": "a1", "score": 4, "justification": "..." } ]`;

/**
 * Resolves the actual Claude model id to use for a given stage type, via
 * the configurable stageModelTiers Setting falling back to constants.js.
 * @param {string} stageType
 * @returns {Promise<string>}
 */
async function resolveModelForStage(stageType) {
  let stageModelTiers = STAGE_MODEL_TIER;
  try {
    const doc = await Setting.findOne({ key: 'stageModelTiers' });
    if (doc?.value && typeof doc.value === 'object') {
      stageModelTiers = doc.value;
    }
  } catch (err) {
    logger.warn(`[AIScorer] Failed to read stageModelTiers setting: ${err.message}`);
  }
  const tier = stageModelTiers[stageType] || STAGE_MODEL_TIER[stageType] || 'cheap';
  const models = await getModelIds();
  return models[tier];
}

function buildUserPrompt(transcriptText, attributes, stageType, requisition, application) {
  const rubric = attributes.map((a) => (
    `attributeId: "${a.attributeId}"\nname: ${a.name}\nquestion: ${a.question || '(none)'}\nwhat a 5 looks like: ${a.anchor5 || '(none)'}\nred flags (1-2): ${a.redFlags || '(none)'}`
  )).join('\n\n');

  let contextHeader = 'INTERVIEW TRANSCRIPT:';
  let requisitionContext = '';

  const isManual = application?.source === 'manual';

  // Public applications are evaluated as two distinct stages: the resume stage
  // uses CV + role criteria, while HR uses only the questionnaire responses.
  if (stageType === 'resume_screen') {
    contextHeader = 'CANDIDATE RESUME TEXT:';
    if (requisition) {
      let criteriaText = '';
      if (Array.isArray(requisition.initialScreeningCriteria) && requisition.initialScreeningCriteria.length > 0) {
        criteriaText = requisition.initialScreeningCriteria.map((c) => {
          if (typeof c === 'string') return `- ${c}`;
          let text = `- Criteria: ${c.criteria}${c.requirement ? ` | Requirement: ${c.requirement}` : ''}`;
          if (c.allowVirtualUniversityOngoing) {
            text += `\n  [SPECIAL POLICY FOR THIS JOB]: Candidates with an ongoing / in-progress degree from Virtual University (or online/distance learning) satisfy the education requirement for full-time work. Do NOT fail or penalize candidates solely because their Virtual University degree is in progress.`;
          }
          if (c.criteria === 'Experience' && (c.minimumValue === '0' || String(c.requirement).includes('Minimum: 0'))) {
            text += `\n  [EXPERIENCE SCORING RULE]: Minimum experience is set to 0 years. Candidates with 0 years of experience, fresh graduates, interns, or candidates with experience measured in months (e.g. 3 to 6 months) SATISFY the minimum experience requirement. Do NOT penalize or fail candidates for having less than 1 year of experience when minimum experience is 0.`;
          }
          return text;
        }).join('\n');
      } else if (typeof requisition.initialScreeningCriteria === 'string' && requisition.initialScreeningCriteria.trim()) {
        criteriaText = requisition.initialScreeningCriteria;
      }

      requisitionContext = `POSITION TITLE: ${requisition.title || ''}\n\nJOB DESCRIPTION:\n${requisition.jobDescription || ''}\n\n${criteriaText ? `INITIAL SCREENING CRITERIA:\n${criteriaText}\n\n` : ''}---\n`;
    }
  } else if ((stageType === 'hr_screen' || stageType === 'hr_interview') && requisition) {
    contextHeader = isManual ? 'HR INTERVIEW TRANSCRIPT:' : 'APPLICATION QUESTIONNAIRE RESPONSES:';
    requisitionContext = `POSITION TITLE: ${requisition.title || ''}\n\nJOB DESCRIPTION:\n${requisition.jobDescription || ''}\n\nEVALUATION GUIDELINES FOR QUESTIONNAIRE RESPONSES:
- For questions with a required Ideal Answer benchmark: Score candidate's response primarily against that provided Ideal Answer benchmark.
- For questions without a required Ideal Answer (or where Ideal Answer is empty): Score candidate's response against the Job Description context and position requirements (evaluating if the candidate's response is clear, professional, and meets what the role requires).
Do not use the candidate CV or Initial Screening Criteria for this stage.\n\n---\n`;
  }

  return `${requisitionContext}${contextHeader}\n${transcriptText}\n\n---\nRUBRIC (score every attribute below):\n\n${rubric}`;
}

/**
 * Scores ONE interview's transcript against ONE stage's rubric via Claude,
 * and persists the result directly onto the interview document: proposed
 * scores go to interview.scores[].aiScore/aiJustification (keyed by
 * attributeId — never by array position), interview.status becomes
 * 'scored', and aiTokensUsed/aiCostUsd are recorded. These are PROPOSED
 * scores only — they do not count until a human approves them
 * (scoringController, built separately).
 *
 * Guardrail: if the transcript is empty or too short to be a real
 * interview, this does NOT call Claude — it marks transcriptStatus
 * 'failed' and returns a message asking for re-upload instead (the
 * Interview schema has no free-text field for this, so the message is
 * returned to the caller to surface, not persisted).
 *
 * @param {object} params
 * @param {import('mongoose').Document} params.interview - Must have transcriptText set.
 * @param {string} params.stageType - The stage's stageType (selects the model tier).
 * @param {Array<{attributeId:string, name:string, question?:string, anchor5?:string, redFlags?:string}>} params.attributes
 *   The scorecard's rubric attributes for this stage.
 * @param {object} [params.requisition] - Optional requisition document for full context.
 * @param {object} [params.application] - Optional application document for candidate source context.
 * @returns {Promise<{interview: import('mongoose').Document, message?: string}>}
 * @throws {import('../utils/errors').ApiKeyError} on 401/403 — never scored on a bad key.
 * @throws {import('../utils/errors').SpendCapError} if the monthly AI spend cap is reached.
 * @throws {import('../utils/errors').RateLimitError} if 429 persists through retries.
 * @throws {import('../utils/errors').ServiceError} on persistent network failure.
 */
async function scoreInterview({ interview, stageType, attributes, requisition, application }) {
  if (!application && interview.applicationId) {
    application = await Application.findById(interview.applicationId);
  }

  const transcriptText = (interview.transcriptText || '').trim();
  const wordCount = transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0;

  if (wordCount < MIN_TRANSCRIPT_WORDS && stageType !== 'hr_screen' && stageType !== 'hr_interview') {
    interview.transcriptStatus = 'failed';
    await interview.save();
    const message = `Transcript is empty or too short to score (${wordCount} words, need at least ${MIN_TRANSCRIPT_WORDS}). Please re-upload a complete transcript.`;
    logger.warn(`[AIScorer] Interview ${interview._id}: ${message}`);
    return { interview, message };
  }

  const model = await resolveModelForStage(stageType);
  logger.info(`[AIScorer] Scoring interview ${interview._id} stage=${stageType} model=${model} attributes=${attributes.length}`);

  const { text, inputTokens, outputTokens, costUsd } = await callClaude({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(transcriptText, attributes, stageType, requisition, application) }],
    maxTokens: 4096,
    expectJson: true,
  });

  const results = JSON.parse(text);
  const resultsByAttributeId = new Map(results.map((r) => [r.attributeId, r]));

  interview.scores = attributes.map((attr) => {
    const result = resultsByAttributeId.get(attr.attributeId);
    const existing = (interview.scores || []).find((s) => s.attributeId === attr.attributeId);
    return {
      attributeId: attr.attributeId,
      aiScore: result?.score,
      aiJustification: result?.justification,
      approvedScore: existing?.approvedScore, // preserve any prior human approval if re-scored
      overridden: existing?.overridden || false,
      overriddenBy: existing?.overriddenBy,
      overrideReason: existing?.overrideReason,
    };
  });
  interview.status = 'scored';
  // Accumulate, don't overwrite — a re-scored interview's cost should
  // reflect every attempt ever made against it, matching how the monthly
  // spend total (claudeClient.js's recordSpend) already accumulates.
  interview.aiTokensUsed = {
    input: (interview.aiTokensUsed?.input || 0) + inputTokens,
    output: (interview.aiTokensUsed?.output || 0) + outputTokens,
  };
  interview.aiCostUsd = (interview.aiCostUsd || 0) + costUsd;

  await interview.save();
  logger.info(`[AIScorer] Interview ${interview._id} scored. costUsd=${costUsd}`);

  return { interview };
}

module.exports = { scoreInterview };
