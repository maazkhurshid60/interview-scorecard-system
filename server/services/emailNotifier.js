const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const { getSecrets } = require('../utils/secrets');

let cachedTransporter = null;
let cachedForUser = null;
let cachedForPassword = null;

/**
 * Builds (and caches) a Nodemailer transporter authenticated against Gmail
 * via an App Password. Re-built whenever either credential changes (e.g. an
 * admin edits Settings, or the App Password is rotated), so a stale
 * transporter never keeps authenticating with a revoked secret.
 *
 * Timeouts are explicit: nodemailer's ~2-minute defaults would let a blocked
 * outbound SMTP port hang the HTTP request that triggered the send until a
 * platform proxy kills it — for a meeting that was already saved.
 * @returns {Promise<import('nodemailer').Transporter|null>} null if not configured.
 */
async function getTransporter() {
  const { gmailUser, gmailAppPassword } = await getSecrets();
  if (!gmailUser || !gmailAppPassword) return null;

  if (cachedTransporter && cachedForUser === gmailUser && cachedForPassword === gmailAppPassword) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailAppPassword },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  cachedForUser = gmailUser;
  cachedForPassword = gmailAppPassword;
  return cachedTransporter;
}

/**
 * Sends an email. Never throws — a missing configuration or a send failure
 * is logged as a warning and reported back via the return value, so a
 * candidate-facing email can never take down the request that triggered it
 * (same philosophy as slackNotifier.js).
 * @param {{to:string, subject:string, text:string}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendEmail({ to, subject, text }) {
  if (!to) return { sent: false, reason: 'No recipient email on file.' };

  const transporter = await getTransporter();
  if (!transporter) {
    logger.warn('[EmailNotifier] Gmail not configured (GMAIL_USER/GMAIL_APP_PASSWORD) — skipping email.');
    return { sent: false, reason: 'Email sending is not configured yet.' };
  }

  const { gmailUser } = await getSecrets();
  try {
    await transporter.sendMail({ from: `"Red Star Technologies" <${gmailUser}>`, to, subject, text });
    logger.info(`[EmailNotifier] Sent "${subject}" to ${to}.`);
    return { sent: true };
  } catch (err) {
    logger.warn(`[EmailNotifier] Failed to send to ${to}: ${err.message}`);
    return { sent: false, reason: 'Failed to send — check Gmail credentials in Settings.' };
  }
}

/**
 * Emails a candidate their interview meeting link.
 * @param {{candidateEmail:string, candidateName:string, requisitionTitle:string, stageLabel:string, meetingUri:string}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendMeetingLinkEmail({ candidateEmail, candidateName, requisitionTitle, stageLabel, meetingUri }) {
  const subject = `Your interview link — ${requisitionTitle} (${stageLabel})`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Here is your meeting link for the ${stageLabel} stage of your ${requisitionTitle} interview:`,
    '',
    meetingUri,
    '',
    'Please join a few minutes early to make sure your camera/microphone are working.',
    '',
    'Best,',
    'Red Star Technologies',
  ].join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

module.exports = { sendEmail, sendMeetingLinkEmail };
