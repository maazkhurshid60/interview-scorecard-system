import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { getSecrets } from '../utils/secrets.js';
import { renderEmail } from '../utils/renderEmail.js';

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
 * The wording of each email lives in templates/emails.js; the functions below only pick the template,
 * pass in the details and send. Every one of them returns what sendEmail returns.
 */

/**
 * Emails a candidate their interview meeting link (used for a link pasted by hand or sent again).
 * @param {{candidateEmail:string, candidateName:string, requisitionTitle:string, stageLabel:string, meetingUri:string, interviewDateTime?:string, interviewTimeZone?:string, interviewDuration?:string}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendMeetingLinkEmail({ candidateEmail, candidateName, requisitionTitle, stageLabel, meetingUri, interviewDateTime, interviewTimeZone, interviewDuration }) {
  const { subject, text } = renderEmail('interviewLink', {
    name: candidateName || 'Candidate',
    jobTitle: requisitionTitle,
    stage: stageLabel,
    dateTime: interviewDateTime,
    timeZone: interviewTimeZone,
    duration: interviewDuration,
    meetingLink: meetingUri,
  });
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
  const { subject, text } = renderEmail(attachment ? 'offerLetterAttached' : 'offerLetterLink', {
    name: candidateName || 'Candidate',
    jobTitle: requisitionTitle,
    offerLetterLink: offerLetterUrl,
  });
  return sendEmail({
    to: candidateEmail,
    subject,
    text,
    attachments: attachment ? [{ filename: attachment.filename, content: attachment.content, contentType: 'application/pdf' }] : undefined,
  });
}

/** Sends a confirmation after a candidate submits a public job application. */
async function sendApplicationConfirmationEmail({ candidateEmail, candidateName, requisitionTitle }) {
  const { subject, text } = renderEmail('applicationReceived', { name: candidateName || 'Candidate', jobTitle: requisitionTitle });
  return sendEmail({ to: candidateEmail, subject, text });
}

/** Sends an internal user a one-time link for changing their password. */
async function sendPasswordResetEmail({ userEmail, userName, resetUrl, expiresInMinutes }) {
  const { subject, text } = renderEmail('passwordReset', { name: userName || 'there', resetLink: resetUrl, minutes: expiresInMinutes });
  return sendEmail({ to: userEmail, subject, text });
}

/** Emails a candidate asking for their preferred interview date & time availability. */
async function sendAvailabilityRequestEmail({ candidateEmail, candidateName, requisitionTitle, stageLabel, availabilityUrl }) {
  const { subject, text } = renderEmail('availabilityRequest', {
    name: candidateName || 'Candidate',
    jobTitle: requisitionTitle,
    stage: stageLabel,
    availabilityLink: availabilityUrl,
  });
  return sendEmail({ to: candidateEmail, subject, text });
}

/** Emails a candidate their ClickUp Onboarding Form link. */
async function sendOnboardingFormEmail({ candidateEmail, candidateName, onboardingUrl }) {
  const url = onboardingUrl || 'https://forms.clickup.com/9018918616/f/8ct3hpr-11198/JXG8EGK3RD18TR60TO';
  const { subject, text } = renderEmail('onboardingForm', { name: candidateName || 'Candidate', onboardingLink: url });
  return sendEmail({ to: candidateEmail, subject, text });
}

/** In production the offer letter is attached as a PDF instead of linked. */
function shouldAttachOfferLetter() {
  return process.env.NODE_ENV === 'production';
}

export { sendEmail, shouldAttachOfferLetter, sendMeetingLinkEmail, sendOfferEmail, sendApplicationConfirmationEmail, sendPasswordResetEmail, sendAvailabilityRequestEmail, sendOnboardingFormEmail };
