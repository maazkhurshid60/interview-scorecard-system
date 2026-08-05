require("dotenv").config({
  path: require("path").join(__dirname, "..", "..", ".env"),
});
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const logger = require("../utils/logger");
const {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_SETTINGS,
  DEFAULT_COST_RATE_TABLE,
} = require("../utils/constants");

const User = require("../models/User");
const PipelineTemplate = require("../models/PipelineTemplate");
const Setting = require("../models/Setting");

/**
 * Idempotently seeds the data a fresh install needs before anyone can log in
 * or create a requisition:
 * - A default admin user (from SEED_ADMIN_* env vars, or safe fallbacks).
 * - One demo login per remaining role (hiring_manager, recruiter, interviewer)
 *   so every role can be logged into and viewed.
 * - The default pipeline template (HR 10% / Simulation 35% / Ops 35% / CEO 20%,
 *   gates 3.0/3.0/3.5/3.5), with the remaining stage types shipped disabled.
 * - Scalar Settings: hire/maybe thresholds, transcript retention days,
 *   monthly AI spend cap, spend warn percent, active transcript provider.
 * - The per-model-tier cost rate table used to compute aiCostUsd.
 *
 * Safe to run multiple times: each section checks for an existing record
 * before creating one, so re-running never duplicates or overwrites
 * something an admin has since changed by hand.
 */
async function seedAdminUser() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const existing = await User.findOne({ email });
  if (existing) {
    logger.info(`[Seed] Admin user already exists (${email}), skipping.`);
    return existing;
  }

  const name = process.env.SEED_ADMIN_NAME || "Admin";
  const password = process.env.SEED_ADMIN_PASSWORD || "change_this_password";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await User.create({
    name,
    email,
    passwordHash,
    role: "admin",
    active: true,
  });

  logger.info(`[Seed] Created default admin user: ${email}`);
  return admin;
}

const DEMO_USERS = [
  {
    role: "hiring_manager",
    email: "hiring_manager@example.com",
    name: "Hiring Manager",
  },
  { role: "recruiter", email: "recruiter@example.com", name: "Recruiter" },
  {
    role: "interviewer",
    email: "interviewer@example.com",
    name: "Interviewer",
  },
];

/**
 * Idempotently seeds one demo login per non-admin role, so every role can be
 * logged into and viewed without waiting on real team accounts. Same
 * exists-by-email check as seedAdminUser — safe to re-run.
 */
async function seedDemoUsers() {
  for (const { role, email, name } of DEMO_USERS) {
    const existing = await User.findOne({ email });
    if (existing) {
      logger.info(`[Seed] ${role} user already exists (${email}), skipping.`);
      continue;
    }

    const passwordHash = await bcrypt.hash("change_this_password", 10);
    await User.create({ name, email, passwordHash, role, active: true });
    logger.info(`[Seed] Created demo ${role} user: ${email}`);
  }
}

async function seedDefaultPipeline() {
  const existing = await PipelineTemplate.findOne({ isDefault: true });
  if (existing) {
    logger.info(
      `[Seed] Default pipeline template already exists ("${existing.name}"), skipping.`,
    );
    return existing;
  }

  const template = await PipelineTemplate.create({
    name: "Standard Hiring Pipeline",
    description:
      "HR Screen (10%) -> Sales Simulation (35%) -> Technical/Ops (35%) -> Final/CEO (20%).",
    isDefault: true,
    stages: DEFAULT_PIPELINE_STAGES,
  });

  logger.info(
    '[Seed] Created default pipeline template "Standard Hiring Pipeline".',
  );
  return template;
}

async function upsertSetting(key, value, description) {
  const result = await Setting.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, value, description, updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return result;
}

async function seedSettings() {
  await upsertSetting(
    "hireThreshold",
    DEFAULT_SETTINGS.hireThreshold,
    "1-5 weighted total required for a HIRE disposition.",
  );
  await upsertSetting(
    "maybeThreshold",
    DEFAULT_SETTINGS.maybeThreshold,
    "1-5 weighted total required for a MAYBE disposition.",
  );
  await upsertSetting(
    "transcriptRetentionDays",
    DEFAULT_SETTINGS.transcriptRetentionDays,
    "Days after a requisition closes before transcripts are purged (0 = never).",
  );
  await upsertSetting(
    "monthlyAiSpendCapUsd",
    DEFAULT_SETTINGS.monthlyAiSpendCapUsd,
    "Monthly Claude API spend cap in USD; scoring blocks once reached.",
  );
  await upsertSetting(
    "aiSpendWarnPercent",
    DEFAULT_SETTINGS.aiSpendWarnPercent,
    "Percent of the monthly spend cap at which a warning is surfaced.",
  );
  await upsertSetting(
    "activeTranscriptProvider",
    DEFAULT_SETTINGS.activeTranscriptProvider,
    "Which transcript provider is active (google_meet in Phase 1).",
  );
  await upsertSetting(
    "aiCostRateTable",
    DEFAULT_COST_RATE_TABLE,
    "USD per 1M tokens (input/output) per model tier (cheap/default/deep). Confirm at console.anthropic.com.",
  );
  await upsertSetting(
    "aiMonthlySpend",
    {},
    'Running AI spend total per calendar month, keyed "YYYY-MM" -> totalUsd. Written by claudeClient.js.',
  );
  await upsertSetting(
    "aiSpendWarnedMonths",
    [],
    'Calendar months ("YYYY-MM") that already triggered a spend-cap warning, so it only fires once per month.',
  );
  await upsertSetting(
    "claudeModelCheap",
    process.env.CLAUDE_MODEL_CHEAP,
    'Model id for the "cheap" tier (resume_screen/reference/background). Editable in Settings — no redeploy needed.',
  );
  await upsertSetting(
    "claudeModelDefault",
    process.env.CLAUDE_MODEL_DEFAULT,
    'Model id for the "default" tier (hr_screen/final/client/culture) and standard-role scorecard generation. Editable in Settings.',
  );
  await upsertSetting(
    "claudeModelDeep",
    process.env.CLAUDE_MODEL_DEEP,
    'Model id for the "deep" tier (technical/simulation/task_performance) and senior-role scorecard generation. Editable in Settings.',
  );
  // Left empty on purpose — an empty override falls back to .env (utils/secrets.js),
  // so seeding this never silently copies a real credential into the database.
  // It only gets a value once an admin explicitly types one into Settings.
  await upsertSetting(
    "anthropicApiKey",
    "",
    "Overrides ANTHROPIC_API_KEY when set; masked in the UI, shown as last-4-only.",
  );
  await upsertSetting(
    "googleClientId",
    "",
    "Overrides GOOGLE_CLIENT_ID when set; masked in the UI.",
  );
  await upsertSetting(
    "googleClientSecret",
    "",
    "Overrides GOOGLE_CLIENT_SECRET when set; masked in the UI.",
  );
  await upsertSetting(
    "googleRefreshToken",
    "",
    "Overrides GOOGLE_REFRESH_TOKEN when set; masked in the UI.",
  );
  await upsertSetting(
    "slackWebhookUrl",
    "",
    "Overrides SLACK_WEBHOOK_URL when set; masked in the UI.",
  );
  logger.info(
    "[Seed] Default settings ensured (thresholds, retention, spend cap, cost rate table, Claude model tiers, credential overrides).",
  );
}

/**
 * Runs the full seed sequence. Exits the process with a non-zero code on
 * failure so `npm run seed` fails loudly instead of silently.
 */
async function run() {
  try {
    await connectDB();
    await seedAdminUser();
    await seedDemoUsers();
    await seedDefaultPipeline();
    await seedSettings();
    logger.info("[Seed] Done.");
    process.exit(0);
  } catch (err) {
    logger.error(`[Seed] Failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  seedAdminUser,
  seedDemoUsers,
  seedDefaultPipeline,
  seedSettings,
};
