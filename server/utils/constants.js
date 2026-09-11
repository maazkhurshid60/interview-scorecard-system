require('dotenv').config();

/** All stage types a PipelineTemplate stage / Requisition stage can have. */
const STAGE_TYPES = [
  'resume_screen', 'hr_screen', 'task_performance', 'technical',
  'simulation', 'final', 'client', 'culture', 'reference',
  'background', 'offer',
];

/** How a stage collects evidence to be scored/gated. */
const INPUT_TYPES = ['transcript', 'artifact', 'pass_fail', 'status_only', 'manual_rubric'];

/** User roles (single role field; full RBAC is Phase 2). */
const USER_ROLES = ['admin', 'hiring_manager', 'recruiter', 'interviewer'];

/** Application-level per-stage progress status. */
const STAGE_PROGRESS_STATUS = [
  'pending', 'scheduled', 'transcript_pending', 'scored', 'approved', 'passed', 'failed',
];

/** Interview instance status. */
const INTERVIEW_STATUS = ['pending', 'scheduled', 'transcript_pending', 'scored', 'approved'];

/** Transcript fetch/upload status. */
const TRANSCRIPT_STATUS = ['none', 'pending', 'ready', 'failed'];

/** Meeting delivery mode + transcript provider. */
const MEETING_MODES = ['online', 'in_person'];
const TRANSCRIPT_PROVIDERS = ['google_meet', 'zoom', 'fathom', 'manual'];

/** Final application disposition computed by the scoring engine. */
const DISPOSITIONS = ['HIRE', 'MAYBE', 'NO_HIRE'];

/** Human decision recorded on an application (always a manual, audited action). */
const FINAL_DECISIONS = ['hired', 'rejected', 'withdrawn'];

/**
 * Every auditable action — one row per meaningful change, immutable.
 * NOTE: 'retention_purge' is not in INSTRUCTIONS.md's original AuditLog enum,
 * but retentionService.js's spec explicitly requires "write an audit entry
 * noting the purge" — the enum had no value that could describe that
 * truthfully, so this one was added rather than mislabeling a purge as some
 * other action.
 */
const AUDIT_ACTIONS = [
  'score_override', 'score_approve', 'question_edit', 'stage_toggle',
  'weight_change', 'disposition_change', 'final_decision',
  'provider_change', 'key_change', 'transcript_upload', 'consent_capture',
  'retention_purge',
];

/**
 * Which model *tier* scores each stage type, per INSTRUCTIONS.md §4 (AI Scorer).
 * The tier is resolved to an actual model id via env at call time
 * (CLAUDE_MODEL_CHEAP / CLAUDE_MODEL_DEFAULT / CLAUDE_MODEL_DEEP).
 * 'offer' has no entry — it's status_only, never scored by Claude at all
 * (INSTRUCTIONS.md's own tier table has no entry for it either).
 */
const STAGE_MODEL_TIER = {
  resume_screen: 'cheap',
  reference: 'cheap',
  background: 'cheap',
  hr_screen: 'default',
  final: 'default',
  client: 'default',
  culture: 'default',
  technical: 'deep',
  simulation: 'deep',
  task_performance: 'deep',
};

/**
 * Default per-tier cost rate table (USD per 1M tokens), seeded into Setting
 * key `aiCostRateTable` so it stays editable from Settings without a redeploy.
 * Confirm current pricing at console.anthropic.com before relying on these.
 */
const DEFAULT_COST_RATE_TABLE = {
  cheap: { inputPerMTokens: 0.80, outputPerMTokens: 4.00 },   // Haiku tier
  default: { inputPerMTokens: 3.00, outputPerMTokens: 15.00 }, // Sonnet tier
  deep: { inputPerMTokens: 15.00, outputPerMTokens: 75.00 },  // Opus tier
};

/** The default pipeline template, exactly per the finalized spec / original Excel. */
const DEFAULT_PIPELINE_STAGES = [
  {
    key: 'hr_screen',
    label: 'HR Screen',
    stageType: 'hr_screen',
    inputType: 'transcript',
    enabled: true,
    order: 1,
    weight: 0.10,
    passThreshold: 3.0,
  },
  {
    key: 'simulation',
    label: 'Sales Simulation',
    stageType: 'simulation',
    inputType: 'manual_rubric',
    enabled: true,
    order: 2,
    weight: 0.35,
    passThreshold: 3.0,
  },
  {
    key: 'technical',
    label: 'Technical / Ops Manager',
    stageType: 'technical',
    inputType: 'transcript',
    enabled: true,
    order: 3,
    weight: 0.35,
    passThreshold: 3.0,
  },
  {
    key: 'final',
    label: 'Final / CEO',
    stageType: 'final',
    inputType: 'transcript',
    enabled: true,
    order: 4,
    weight: 0.20,
    passThreshold: 3.0,
  },
  // Shipped disabled; HR enables per-requisition as needed.
  {
    key: 'resume_screen',
    label: 'Résumé Screen',
    stageType: 'resume_screen',
    inputType: 'artifact',
    enabled: false,
    order: 0,
    weight: 0,
    passThreshold: 3.0,
  },
  {
    key: 'task_performance',
    label: 'Task Performance',
    stageType: 'task_performance',
    inputType: 'manual_rubric',
    enabled: false,
    order: 5,
    weight: 0,
    passThreshold: 3.0,
  },
  {
    key: 'client',
    label: 'Client Interview',
    stageType: 'client',
    inputType: 'transcript',
    enabled: false,
    order: 6,
    weight: 0,
    passThreshold: 3.0,
  },
  {
    key: 'culture',
    label: 'Culture Fit',
    stageType: 'culture',
    inputType: 'transcript',
    enabled: false,
    order: 7,
    weight: 0,
    passThreshold: 3.0,
  },
  {
    key: 'reference',
    label: 'Reference Check',
    stageType: 'reference',
    inputType: 'transcript',
    enabled: false,
    order: 8,
    weight: 0,
    passThreshold: 3.0,
  },
  {
    key: 'background',
    label: 'Background Check',
    stageType: 'background',
    inputType: 'pass_fail',
    enabled: false,
    order: 9,
    weight: 0,
    passThreshold: 3.0,
  },
  {
    key: 'offer',
    label: 'Offer',
    stageType: 'offer',
    inputType: 'status_only',
    enabled: false,
    order: 10,
    weight: 0,
    passThreshold: 3.0,
  },
];

/** Default scalar settings, seeded into the Setting collection. */
const DEFAULT_SETTINGS = {
  hireThreshold: Number(process.env.DEFAULT_HIRE_THRESHOLD) || 3.5,
  maybeThreshold: Number(process.env.DEFAULT_MAYBE_THRESHOLD) || 3.0,
  transcriptRetentionDays: Number(process.env.TRANSCRIPT_RETENTION_DAYS) || 90,
  monthlyAiSpendCapUsd: Number(process.env.MONTHLY_AI_SPEND_CAP_USD) || 200,
  aiSpendWarnPercent: Number(process.env.AI_SPEND_WARN_PERCENT) || 80,
  activeTranscriptProvider: process.env.ACTIVE_TRANSCRIPT_PROVIDER || 'google_meet',
};

module.exports = {
  STAGE_TYPES,
  INPUT_TYPES,
  USER_ROLES,
  STAGE_PROGRESS_STATUS,
  INTERVIEW_STATUS,
  TRANSCRIPT_STATUS,
  MEETING_MODES,
  TRANSCRIPT_PROVIDERS,
  DISPOSITIONS,
  FINAL_DECISIONS,
  AUDIT_ACTIONS,
  STAGE_MODEL_TIER,
  DEFAULT_COST_RATE_TABLE,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_SETTINGS,
};
