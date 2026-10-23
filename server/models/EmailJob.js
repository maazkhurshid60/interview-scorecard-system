const mongoose = require('mongoose');

/**
 * One row per email waiting to be sent (see services/emailQueue.js). Requests
 * save a job and answer immediately; the queue sends it in the background and
 * retries if the mail server is down or slow.
 *
 * Finished rows are deleted automatically (sent after 30 days, failed after 90).
 */
const emailJobSchema = new mongoose.Schema({
  type: { type: String, required: true },          // which email: see SENDERS in services/emailQueue.js
  to: { type: String, required: true },            // recipient (for logs / support)
  payload: { type: mongoose.Schema.Types.Mixed, default: {} }, // the details the email template needs
  attachment: {                                    // only the production offer letter; removed once sent
    filename: String,
    contentType: String,
    content: Buffer,
  },
  related: {                                       // what to update when the email is really sent
    kind: String,                                  // 'offer-letter' | 'interview-offer' | 'onboarding-form' | 'application-confirmation'
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  },
  dedupeKey: String,                               // the same key can only be queued once
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,                                  // when the current attempt started (detects a job left by a restart)
  sentAt: Date,
  lastError: String,
  expireAt: Date,                                  // set when finished; MongoDB then deletes the row
}, { timestamps: true });

// The same dedupeKey can only be queued once (used to avoid duplicate confirmation emails).
emailJobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
emailJobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailJob', emailJobSchema);
