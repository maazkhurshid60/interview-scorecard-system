const mongoose = require('mongoose');
const { STAGE_TYPES, INPUT_TYPES } = require('../utils/constants');

const stageSchema = new mongoose.Schema({
  key: { type: String, required: true },        // 'hr_screen', 'technical', etc.
  label: { type: String, required: true },      // Display name
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
  order: { type: Number, required: true },       // Position in the pipeline
  weight: { type: Number, default: 0 },          // 0..1 ; enabled scored weights sum to 1
  passThreshold: { type: Number, default: 3.0 }, // 1-5 gate; ignored for status_only
}, { _id: false });

const pipelineTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  isDefault: { type: Boolean, default: false, index: true },
  stages: [stageSchema],
}, { timestamps: true });

module.exports = mongoose.model('PipelineTemplate', pipelineTemplateSchema);
