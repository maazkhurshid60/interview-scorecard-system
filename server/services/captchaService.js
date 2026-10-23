const axios = require('axios');
const logger = require('../utils/logger');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function getCaptchaConfig() {
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  return { siteKey, secretKey, enabled: Boolean(siteKey && secretKey) };
}

/**
 * Validates a Cloudflare Turnstile token. Tokens are single-use and are
 * checked immediately before the application is accepted.
 */
async function verifyCaptcha(token, remoteip) {
  const { secretKey, enabled } = getCaptchaConfig();
  if (!enabled) return { valid: true, disabled: true };
  if (!token || typeof token !== 'string') return { valid: false };

  try {
    const params = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteip) params.append('remoteip', remoteip);
    const { data } = await axios.post(TURNSTILE_VERIFY_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
    });

    if (!data?.success) {
      logger.warn(`[Captcha] Turnstile verification rejected: ${(data?.['error-codes'] || []).join(', ') || 'unknown error'}`);
    }
    return { valid: data?.success === true };
  } catch (err) {
    logger.error(`[Captcha] Turnstile verification request failed: ${err.message}`);
    return { valid: false };
  }
}

module.exports = { getCaptchaConfig, verifyCaptcha };
