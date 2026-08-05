const mongoose = require('mongoose');

const attributeSchema = new mongoose.Schema({
  attributeId: { type: String, required: true },   // Stable id used by scores
  name: { type: String, required: true },           // e.g., "Quick Discovery"
  question: String,                                  // Interviewer question
  anchor5: String,                                   // What a score of 5 looks like
  redFlags: String,                                  // What a 1-2 looks like
}, { _id: false });

const scorecardStageSchema = new mongoose.Schema({
  stageKey: { type: String, required: true },
  attributes: [attributeSchema],
}, { _id: false });


const scorecardSchema = new mongoose.Schema({
  requisitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', required: true, index: true },
  generatedByAI: { type: Boolean, default: true },
  stages: [scorecardStageSchema],
}, { timestamps: true });

module.exports = mongoose.model('Scorecard', scorecardSchema);
