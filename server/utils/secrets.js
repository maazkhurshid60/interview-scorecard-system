const Setting = require('../models/Setting');

/** Every credential an admin can override from Settings, instead of editing .env + redeploying. */
const SECRET_SETTING_KEYS = [
  'anthropicApiKey', 'googleClientId', 'googleClientSecret', 'googleRefreshToken', 'slackWebhookUrl',
];

/**
 * Resolves every overridable credential, letting an admin-set Setting take
 * priority over the .env bootstrap value — same override-then-fallback
 * pattern claudeClient.js already uses for model tiers. Real values are only
 * ever used server-side; nothing here is sent back to the frontend as-is
 * (see maskSecret) — that's what keeps "masked, show last 4" honest.
 * @returns {Promise<{anthropicApiKey:string, googleClientId:string, googleClientSecret:string, googleRefreshToken:string, slackWebhookUrl:string}>}
 */
async function getSecrets() {
  const docs = await Setting.find({ key: { $in: SECRET_SETTING_KEYS } });
  const map = {};
  docs.forEach((doc) => { map[doc.key] = doc.value; });
  return {
    anthropicApiKey: map.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    googleClientId: map.googleClientId || process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: map.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET,
    googleRefreshToken: map.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN,
    slackWebhookUrl: map.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL,
  };
}

/**
 * Masks a secret for display — every character hidden except the last 4, per
 * the "API key inputs (masked, show last 4)" spec. Never returns the real
 * value; returns null for an unset/empty secret so the UI can show
 * "Not configured" instead of a misleading empty mask.
 * @param {string|undefined} value
 * @returns {string|null}
 */
function maskSecret(value) {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(str.length - 4, 12))}${str.slice(-4)}`;
}

module.exports = { getSecrets, maskSecret, SECRET_SETTING_KEYS };
