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
 * @param {{to:string, subject:string, text:string, attachments?: Array<{filename:string, content:Buffer}>}} params
 * @returns {Promise<{sent:boolean, reason?:string, permanent?:boolean}>}
 */
async function sendEmail({ to, subject, text, attachments }) {
  // `permanent: true` tells the email queue not to retry: trying again cannot help.
  if (!to) return { sent: false, reason: 'No recipient email on file.', permanent: true };

  const transporter = await getTransporter();
  if (!transporter) {
    logger.warn('[EmailNotifier] Gmail not configured (GMAIL_USER/GMAIL_APP_PASSWORD) — skipping email.');
    return { sent: false, reason: 'Email sending is not configured yet.' };
  }

  const { gmailUser } = await getSecrets();
  try {
    await transporter.sendMail({ from: `"Red Star Technologies" <${gmailUser}>`, to, subject, text, ...(attachments?.length ? { attachments } : {}) });
    logger.info(`[EmailNotifier] Sent "${subject}" to ${to}.`);
    return { sent: true };
  } catch (err) {
    logger.warn(`[EmailNotifier] Failed to send to ${to}: ${err.message}`);
    // 550-554 = the mail server refused this recipient address, so retrying will never work.
    const rejected = Number(err.responseCode) >= 550 && Number(err.responseCode) <= 554;
    return {
      sent: false,
      reason: rejected ? 'The recipient address was rejected by the mail server.' : 'Failed to send — check Gmail credentials in Settings.',
      permanent: rejected,
    };
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

/**
 * Emails a candidate their formal job offer letter. In production the PDF itself
 * is attached (stored files are private, so a link would not open for the
 * candidate); on staging / local the email carries a link instead.
 * @param {{candidateEmail:string, candidateName:string, requisitionTitle:string, offerLetterUrl?:string, attachment?:{filename:string, content:Buffer}}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendOfferEmail({ candidateEmail, candidateName, requisitionTitle, offerLetterUrl, attachment }) {
  const subject = `Job Offer — ${requisitionTitle}`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Congratulations! We are delighted to extend a formal job offer for the ${requisitionTitle} position at Red Star Technologies.`,
    '',
    attachment
      ? 'Your official Offer Letter is attached to this email as a PDF.'
      : (offerLetterUrl ? `You can view and download your official Offer Letter here:\n${offerLetterUrl}` : ''),
    '',
    'Please review the details and let us know if you have any questions.',
    '',
    'Best regards,',
    'Red Star Technologies Hiring Team',
  ].filter(Boolean).join('\n');

  return sendEmail({
    to: candidateEmail,
    subject,
    text,
    attachments: attachment ? [{ filename: attachment.filename, content: attachment.content, contentType: 'application/pdf' }] : undefined,
  });
}

/** Sends a confirmation after a candidate submits a public job application. */
async function sendApplicationConfirmationEmail({ candidateEmail, candidateName, requisitionTitle }) {
  const subject = `Application received — ${requisitionTitle}`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Thank you for applying for the ${requisitionTitle} position at Red Star Technologies.`,
    '',
    'We have received your application and our hiring team will review it.',
    '',
    'Best regards,',
    'Red Star Technologies Hiring Team',
  ].join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

/** Sends an internal user a one-time link for changing their password. */
async function sendPasswordResetEmail({ userEmail, userName, resetUrl, expiresInMinutes }) {
  const subject = 'Reset your OWNERS TALENT password';
  const text = [
    `Hi ${userName || 'there'},`,
    '',
    'We received a request to reset your OWNERS TALENT password.',
    '',
    `Choose a new password here (this link expires in ${expiresInMinutes} minutes):`,
    resetUrl,
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    'Red Star Technologies',
  ].join('\n');

  return sendEmail({ to: userEmail, subject, text });
}

/** Emails a candidate asking for their preferred interview date & time availability. */
async function sendAvailabilityRequestEmail({ candidateEmail, candidateName, requisitionTitle, stageLabel, availabilityUrl }) {
  const subject = `Please provide your availability — ${requisitionTitle} (${stageLabel})`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Our hiring team would like to arrange your interview for the ${stageLabel} stage of your application for ${requisitionTitle}.`,
    '',
    'Please click the link below to select your preferred date and time windows:',
    availabilityUrl,
    '',
    'Thank you,',
    'Red Star Technologies Hiring Team',
  ].join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

/** Emails a candidate their ClickUp Onboarding Form link. */
async function sendOnboardingFormEmail({ candidateEmail, candidateName, onboardingUrl }) {
  const url = onboardingUrl || 'https://forms.clickup.com/9018918616/f/8ct3hpr-11198/JXG8EGK3RD18TR60TO';
  const subject = 'ON BOARDING FORM — Red Star Technologies';
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    'ON BOARDING FORM',
    'Welcome to Red Star Technologies! We are thrilled to have you join our team. This onboarding document outlines the key information, policies, and tools you need to integrate smoothly into our work environment. We are committed to supporting your success.',
    '',
    'Please complete your onboarding form using the link below:',
    url,
    '',
    'Best regards,',
    'Red Star Technologies Hiring Team',
  ].join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

/** In production the offer letter is attached as a PDF instead of linked. */
function shouldAttachOfferLetter() {
  return process.env.NODE_ENV === 'production';
}

module.exports = { sendEmail, shouldAttachOfferLetter, sendMeetingLinkEmail, sendOfferEmail, sendApplicationConfirmationEmail, sendPasswordResetEmail, sendAvailabilityRequestEmail, sendOnboardingFormEmail };
