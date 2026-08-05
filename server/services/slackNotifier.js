const axios = require('axios');
const logger = require('../utils/logger');
const { getSecrets } = require('../utils/secrets');

/** Base URL of the frontend, used to build "review this" links in notifications. */
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

/**
 * Posts a message to the configured Slack Incoming Webhook. Never blocks or
 * crashes the caller — an invalid webhook URL or network failure is logged
 * as a warning and swallowed. Slack notifications are a nice-to-have, not a
 * dependency any core workflow should ever fail on.
 * @param {string} text - Slack mrkdwn-formatted message text.
 * @returns {Promise<void>}
 */
async function sendMessage(text) {
  const { slackWebhookUrl: webhookUrl } = await getSecrets();
  if (!webhookUrl || webhookUrl.includes('your/webhook/url')) {
    logger.warn('[SlackNotifier] SLACK_WEBHOOK_URL not configured — skipping notification.');
    return;
  }
  try {
    await axios.post(webhookUrl, { text }, { timeout: 10000 });
  } catch (err) {
    logger.warn(`[SlackNotifier] Failed to send Slack message: ${err.message}`);
  }
}

/**
 * Notifies that a transcript was scored by AI and is now waiting for HR approval.
 * @param {{requisitionTitle:string, candidateName:string, stageLabel:string, aiStageAverage:number, interviewId:string}} params
 */
async function notifyTranscriptReady({ requisitionTitle, candidateName, stageLabel, aiStageAverage, interviewId }) {
  const text = [
    ':jigsaw: *Interview Scored — Ready for Review*',
    `*Requisition:* ${requisitionTitle}`,
    `*Candidate:* ${candidateName}`,
    `*Stage:* ${stageLabel}`,
    `*AI stage average:* ${aiStageAverage} / 5  → awaiting HR approval`,
    `:inbox_tray: Review at: ${CLIENT_URL}/interview/${interviewId}`,
  ].join('\n');
  await sendMessage(text);
}

/**
 * Notifies that a final human decision (hired/rejected/withdrawn) was recorded.
 * @param {{requisitionTitle:string, candidateName:string, decision:string, applicationId:string}} params
 */
async function notifyFinalDecision({ requisitionTitle, candidateName, decision, applicationId }) {
  const text = [
    ':checkered_flag: *Final Decision Recorded*',
    `*Requisition:* ${requisitionTitle}`,
    `*Candidate:* ${candidateName}`,
    `*Decision:* ${decision.toUpperCase()}`,
    `:inbox_tray: View at: ${CLIENT_URL}/application/${applicationId}`,
  ].join('\n');
  await sendMessage(text);
}

/**
 * Notifies that a candidate has been sitting in one stage for more than N days.
 * @param {{requisitionTitle:string, candidateName:string, stageLabel:string, daysStuck:number, applicationId:string}} params
 */
async function notifyCandidateStuck({ requisitionTitle, candidateName, stageLabel, daysStuck, applicationId }) {
  const text = [
    ':hourglass_flowing_sand: *Candidate Stuck in Stage*',
    `*Requisition:* ${requisitionTitle}`,
    `*Candidate:* ${candidateName}`,
    `*Stage:* ${stageLabel} (${daysStuck} days)`,
    `:inbox_tray: Review at: ${CLIENT_URL}/application/${applicationId}`,
  ].join('\n');
  await sendMessage(text);
}

/**
 * Notifies that the monthly AI spend crossed the configured warn threshold.
 * @param {{monthKey:string, spend:number, capUsd:number}} params
 */
async function notifySpendWarning({ monthKey, spend, capUsd }) {
  const text = [
    ':warning: *Monthly AI Spend Warning*',
    `*Month:* ${monthKey}`,
    `*Spend so far:* $${spend.toFixed(2)} of a $${capUsd} cap`,
    `:inbox_tray: Review at: ${CLIENT_URL}/settings`,
  ].join('\n');
  await sendMessage(text);
}

module.exports = { notifyTranscriptReady, notifyFinalDecision, notifyCandidateStuck, notifySpendWarning };