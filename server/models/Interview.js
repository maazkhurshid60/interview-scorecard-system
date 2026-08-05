const mongoose = require('mongoose');
const { MEETING_MODES, TRANSCRIPT_PROVIDERS, TRANSCRIPT_STATUS, INTERVIEW_STATUS } = require('../utils/constants');

const scoreSchema = new mongoose.Schema({
  attributeId: { type: String, required: true },
  aiScore: Number,             // 1-5 proposed by Claude
  aiJustification: String,     // Short, cites the transcript
  approvedScore: Number,       // 1-5 human-approved (defaults to aiScore on approve)
  overridden: { type: Boolean, default: false },
  overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  overrideReason: String,
}, { _id: false });

const interviewSchema = new mongoose.Schema({
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
  requisitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', required: true, index: true },
  stageKey: { type: String, required: true },

  meetingMode: { type: String, enum: MEETING_MODES, default: 'online' },
  provider: { type: String, enum: TRANSCRIPT_PROVIDERS, default: 'google_meet' },
  meetingUri: String,          // Created via provider API, or pasted by HR
  conferenceId: String,        // Provider's record id — maps transcript back to THIS interview
  designatedScorerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  consentObtained: { type: Boolean, default: false },   // HR confirms candidate consent before recording
  transcriptText: String,      // Fetched or manually uploaded
  transcriptStatus: { type: String, enum: TRANSCRIPT_STATUS, default: 'none' },
  artifactFileUrl: String,     // Cloudinary secure_url — for task_performance / resume_screen stages
  artifactFilePublicId: String, // Cloudinary public_id — needed to delete the file on retention purge

  scores: [scoreSchema],
  stageAverage: Number,        // From approvedScore values
  status: { type: String, enum: INTERVIEW_STATUS, default: 'pending' },

  aiTokensUsed: { input: Number, output: Number },
  aiCostUsd: Number,
}, { timestamps: true });

module.exports = mongoose.model('Interview', interviewSchema);
