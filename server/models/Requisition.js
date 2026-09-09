const mongoose = require('mongoose');
const { STAGE_TYPES, INPUT_TYPES } = require('../utils/constants');

const requisitionStageSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  stageType: {
    type: String,
    enum: STAGE_TYPES,
    required: true,
  },
  inputType: {
    type: String,
    enum: INPUT_TYPES,
    required: true,
  },
  enabled: { type: Boolean, default: true },
  order: { type: Number, required: true },
  weight: { type: Number, default: 0 },
  passThreshold: { type: Number, default: 3.0, min: 1, max: 5 },
}, { _id: false });

const requisitionSchema = new mongoose.Schema({
  title: { type: String, required: true, index: true },   // e.g., "Sales Executive / Closer"
  jobDescription: { type: String, required: true },        // Pasted JD — source for AI generation
  status: {
    type: String,
    enum: ['open', 'on_hold', 'closed'],
    default: 'open',
    index: true,
  },
  pipelineTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'PipelineTemplate' },
  // Snapshot of stages at creation, so later template edits don't mutate an open req
  stages: [requisitionStageSchema],
  scorecardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scorecard' },
  hireThreshold: { type: Number, default: 3.5, min: 1, max: 5 },
  maybeThreshold: { type: Number, default: 3.0, min: 1, max: 5 },
  closedAt: Date,                                          // Drives retention purge
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Requisition', requisitionSchema);
