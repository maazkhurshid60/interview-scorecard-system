const mongoose = require('mongoose');
const { STAGE_PROGRESS_STATUS, DISPOSITIONS, FINAL_DECISIONS } = require('../utils/constants');

const applicationSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  requisitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', required: true, index: true },

  currentStageKey: String,     // Which stage they're on now
  stageProgress: [{
    stageKey: String,
    status: { type: String, enum: STAGE_PROGRESS_STATUS, default: 'pending' },
    stageAverage: Number,      // 1-5 average of approved attribute scores
    passed: Boolean,           // stageAverage >= passThreshold
  }],

  // Final results (computed by scoringEngine)
  weightedTotal: Number,       // 1-5
  allGatesPassed: Boolean,
  disposition: { type: String, enum: [...DISPOSITIONS, null], default: null },
  rank: Number,                // Within the requisition

  finalDecision: { type: String, enum: [...FINAL_DECISIONS, null], default: null },
  finalDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: String,
}, { timestamps: true });

applicationSchema.index({ requisitionId: 1, weightedTotal: -1 });

module.exports = mongoose.model('Application', applicationSchema);
