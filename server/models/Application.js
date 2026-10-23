const mongoose = require('mongoose');
const { STAGE_PROGRESS_STATUS, DISPOSITIONS, FINAL_DECISIONS } = require('../utils/constants');

const applicationSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  requisitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', required: true, index: true },

  currentStageKey: String,     // Which stage they're on now
  source: { type: String, enum: ['public_link', 'manual'], default: 'manual' },
  opportunityDuration: String,
  questionnaireAnswers: mongoose.Schema.Types.Mixed,
  candidateAvailability: {
    preferredDate: String,
    startTime: String,
    endTime: String,
    notes: String,
    submittedAt: Date,
  },
  // Background AI screening of a public application (see services/applicationProcessor.js).
  // Only set on applications that came through the public form.
  screeningJob: {
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'] },
    attempts: { type: Number, default: 0 },
    lockedAt: Date,                  // when the current attempt started (detects a job left behind by a restart)
    completedAt: Date,
    lastError: String,
    confirmationEmailSentAt: Date,   // so a retry never sends the confirmation twice
  },
  stageProgress: [{
    stageKey: String,
    status: { type: String, enum: STAGE_PROGRESS_STATUS, default: 'pending' },
    stageAverage: Number,      // 1-5 average of approved attribute scores
    passed: Boolean,           // stageAverage >= passThreshold
  }],

  // Initial Screening (CV vs Criteria / Questionnaire)
  initialScreening: {
    aiScore: Number,
    aiJustification: String,
    passed: Boolean,
    overridden: { type: Boolean, default: false },
    overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overrideReason: String,
  },

  // Final results (computed by scoringEngine)
  weightedTotal: Number,       // 1-5
  allGatesPassed: Boolean,
  disposition: { type: String, enum: [...DISPOSITIONS, null], default: null },
  rank: Number,                // Within the requisition

  finalDecision: { type: String, enum: [...FINAL_DECISIONS, null], default: null },
  finalDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: String,

  // Offer letters are application-level documents, not pipeline stages.
  offerLetterUrl: String,
  offerLetterPublicId: String,
  offerLetterFileName: String,
  offerLetterFileSize: Number,    // bytes, before any compression
  offerLetterFileMimeType: String,
  offerLetterUploadedAt: Date,
  offerLetterTemplateKey: String,                          // set when the letter was made from a template (null for an uploaded PDF)
  offerLetterFields: mongoose.Schema.Types.Mixed,          // the values filled into that template
  offerLetterDeliveryStatus: { type: String, enum: ['pending', 'sent'] },
  offerLetterSentAt: Date,

  onboardingFormDeliveryStatus: { type: String, enum: ['pending', 'sent'] },
  onboardingFormSentAt: Date,
}, { timestamps: true });

applicationSchema.index({ requisitionId: 1, weightedTotal: -1 });

module.exports = mongoose.model('Application', applicationSchema);
