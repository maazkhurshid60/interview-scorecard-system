import mongoose from 'mongoose';
import { STAGE_PROGRESS_STATUS, DISPOSITIONS, FINAL_DECISIONS, REVIEW_STATUS, REVIEW_DECISIONS } from '../utils/constants.js';

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

  // What the candidate stated on the public form about the job's minimum requirements, and how code compared it
  // (no AI): { answers: { education, experienceYears }, checks: [{ criteria, required, answered, met }] }
  requirements: mongoose.Schema.Types.Mixed,

  // A person's review of a public application. The AI only recommends: nothing moves a candidate on or rejects
  // them until a reviewer decides here (see services/screeningReview.js).
  screeningReview: {
    status: { type: String, enum: REVIEW_STATUS },
    aiScore: Number,             // average of the screening stages' AI scores: reviewers work from the highest down
    aiRecommendation: { type: String, enum: REVIEW_DECISIONS },
    decision: { type: String, enum: REVIEW_DECISIONS }, // the reviewer's decision: it counts over the stages' score gates
    reason: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
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

export default mongoose.model('Application', applicationSchema);
