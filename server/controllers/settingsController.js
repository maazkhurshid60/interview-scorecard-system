const axios = require('axios');
const { google } = require('googleapis');
const Setting = require('../models/Setting');
const Interview = require('../models/Interview');
const Requisition = require('../models/Requisition');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');
const { ValidationError, ApiKeyError } = require('../utils/errors');
const { STAGE_MODEL_TIER } = require('../utils/constants');
const { callClaude, getModelIds } = require('../services/claudeClient');
const { getSecrets, maskSecret, SECRET_SETTING_KEYS } = require('../utils/secrets');

/**
 * GET /api/settings — all settings, sorted by key. Credential keys
 * (anthropicApiKey, googleClientSecret, ...) never leave the server in full —
 * their value is stripped here even though they live in the same
 * collection as every other (non-sensitive) setting. Use key-status for a
 * masked preview of those instead.
 */
const list = asyncHandler(async (req, res) => {
  const settings = await Setting.find().sort({ key: 1 });
  const sanitized = settings.map((s) => (
    SECRET_SETTING_KEYS.includes(s.key) ? { ...s.toObject(), value: undefined } : s
  ));
  res.json({ settings: sanitized });
});

/**
 * GET /api/settings/key-status
 * Whether each external service's credentials are configured (Setting
 * override or .env fallback), plus a masked preview per credential — never
 * the real value. Per-service `configured` still reflects whether every
 * required piece is present (Google needs all three).
 */
const keyStatus = asyncHandler(async (req, res) => {
  const secrets = await getSecrets();
  res.json({
    claude: {
      configured: !!secrets.anthropicApiKey,
      keys: { anthropicApiKey: maskSecret(secrets.anthropicApiKey) },
    },
    google_meet: {
      configured: !!(secrets.googleClientId && secrets.googleClientSecret && secrets.googleRefreshToken),
      keys: {
        googleClientId: maskSecret(secrets.googleClientId),
        googleClientSecret: maskSecret(secrets.googleClientSecret),
        googleRefreshToken: maskSecret(secrets.googleRefreshToken),
      },
    },
    slack: {
      configured: !!secrets.slackWebhookUrl,
      keys: { slackWebhookUrl: maskSecret(secrets.slackWebhookUrl) },
    },
  });
});

/** PUT /api/settings/:key — update a setting's value (thresholds, retention, provider, spend cap, ...). */
const update = asyncHandler(async (req, res) => {
  const setting = await Setting.findOne({ key: req.params.key });
  if (!setting) return res.status(404).json({ error: 'NOT_FOUND', message: `No setting found with key "${req.params.key}".` });

  if (req.body.value === undefined) throw new ValidationError(['value'], 'value is required.');

  const oldValue = setting.value;
  setting.value = req.body.value;
  setting.updatedAt = new Date();
  await setting.save();

  await AuditLog.create({
    action: setting.key === 'activeTranscriptProvider' ? 'provider_change' : 'key_change',
    userId: req.user._id, targetType: 'setting', targetId: setting.key,
    oldValue, newValue: setting.value, reason: `Setting "${setting.key}" updated.`,
  });

  logger.info(`[Settings] Updated "${setting.key}" by user=${req.user._id}`);
  res.json({ setting });
});

/**
 * POST /api/settings/test-api
 * Body: { service: 'claude' | 'google_meet' | 'slack' }
 * Runs a lightweight real connectivity check against the requested service.
 */
const testApi = asyncHandler(async (req, res) => {
  const { service } = req.body;

  // Builds the same clean, typed shape errorHandler.js uses for an
  // unhandled ApiKeyError — test-api always responds 200 (it's a
  // connectivity check, not the operation itself), so it can't rely on the
  // global error handler and has to construct this shape itself.
  const describeError = (err) => {
    if (err instanceof ApiKeyError) {
      return { error: err.errorCode, message: `${err.service} connection failed or expired. Reconnect in Settings. (${err.message})` };
    }
    // Google's OAuth2 token endpoint reports a revoked/expired/invalid
    // refresh token as {error: 'invalid_grant'} — its error_description is
    // often just a generic "Bad Request", so detect the code itself rather
    // than relying on that description being useful.
    if (err.response?.data?.error === 'invalid_grant') {
      return { error: 'API_KEY_ERROR', message: 'Google connection expired. Reconnect in Settings.' };
    }
    return { error: 'SERVICE_ERROR', message: err.response?.data?.error_description || err.message };
  };

  if (service === 'claude') {
    try {
      const models = await getModelIds();
      await callClaude({
        model: models.cheap,
        system: 'Reply with exactly one word.',
        messages: [{ role: 'user', content: 'Reply "ok".' }],
        maxTokens: 10,
      });
      return res.json({ service, status: 'ok' });
    } catch (err) {
      return res.json({ service, status: 'error', ...describeError(err) });
    }
  }

  if (service === 'google_meet') {
    try {
      const { googleClientId, googleClientSecret, googleRefreshToken } = await getSecrets();
      const client = new google.auth.OAuth2(googleClientId, googleClientSecret, process.env.GOOGLE_REDIRECT_URI);
      client.setCredentials({ refresh_token: googleRefreshToken });
      await client.getAccessToken();
      return res.json({ service, status: 'ok' });
    } catch (err) {
      return res.json({ service, status: 'error', ...describeError(err) });
    }
  }

  if (service === 'slack') {
    const { slackWebhookUrl: webhookUrl } = await getSecrets();
    if (!webhookUrl) return res.json({ service, status: 'error', error: 'VALIDATION_ERROR', message: 'SLACK_WEBHOOK_URL is not configured.' });
    try {
      await axios.post(webhookUrl, { text: ':white_check_mark: Test connection from Interview Scorecard System.' }, { timeout: 10000 });
      return res.json({ service, status: 'ok' });
    } catch (err) {
      return res.json({ service, status: 'error', ...describeError(err) });
    }
  }

  throw new ValidationError(['service'], 'service must be one of: claude, google_meet, slack.');
});

/**
 * GET /api/settings/ai-usage
 * Token + cost totals grouped by model tier, stage, requisition, and month.
 */
const aiUsage = asyncHandler(async (req, res) => {
  const grouped = await Interview.aggregate([
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
  ]);

  const requisitionIds = [...new Set(grouped.map((g) => String(g._id.requisitionId)))];
  const requisitions = await Requisition.find({ _id: { $in: requisitionIds } }, 'title stages');
  const requisitionById = new Map(requisitions.map((r) => [String(r._id), r]));

  const rows = grouped.map((g) => {
    const requisition = requisitionById.get(String(g._id.requisitionId));
    const stageConfig = requisition?.stages.find((s) => s.key === g._id.stageKey);
    const tier = stageConfig ? STAGE_MODEL_TIER[stageConfig.stageType] : undefined;
    const model = tier === 'cheap' ? process.env.CLAUDE_MODEL_CHEAP
      : tier === 'deep' ? process.env.CLAUDE_MODEL_DEEP
        : tier === 'default' ? process.env.CLAUDE_MODEL_DEFAULT : undefined;

    return {
      requisitionId: g._id.requisitionId,
      requisitionTitle: requisition?.title || '(deleted requisition)',
      stageKey: g._id.stageKey,
      month: g._id.month,
      model,
      totalCostUsd: Math.round(g.totalCostUsd * 1e6) / 1e6,
      totalInputTokens: g.totalInputTokens,
      totalOutputTokens: g.totalOutputTokens,
      interviewCount: g.interviewCount,
    };
  });

  const totalCostUsd = Math.round(rows.reduce((sum, r) => sum + r.totalCostUsd, 0) * 1e6) / 1e6;
  res.json({ rows, totalCostUsd });
});

module.exports = { list, update, testApi, aiUsage, keyStatus };
