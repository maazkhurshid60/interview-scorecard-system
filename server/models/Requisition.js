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

const questionnaireItemSchema = new mongoose.Schema({
  question: { type: String, required: true },
  idealAnswer: { type: String, default: '' },
  requireIdealAnswer: { type: Boolean, default: false },
}, { _id: false });

const screeningCriteriaItemSchema = new mongoose.Schema({
  criteria: { type: String, required: true },
  requirement: { type: String, default: '' },
  minimumValue: { type: String, default: '' },
  maximumValue: { type: String, default: '' },
  relevantField: { type: String, default: '' },
  allowVirtualUniversityOngoing: { type: Boolean, default: false },
}, { _id: false });

const internshipDetailsSchema = new mongoose.Schema({
  duration: { type: String, default: '' },
  paidStatus: { type: String, enum: ['paid', 'unpaid'], default: 'paid' },
  workingHours: { type: String, default: '' },
}, { _id: false });

const workingHoursDetailsSchema = new mongoose.Schema({
  workingHours: { type: String, default: '' },
}, { _id: false });

const partTimeDetailsSchema = new mongoose.Schema({
  weeklyHours: { type: String, default: '' },
  workingHours: { type: String, default: '' },
}, { _id: false });

const contractDetailsSchema = new mongoose.Schema({
  duration: { type: String, default: '' },
  workingHours: { type: String, default: '' },
  paymentRate: { type: String, default: '' },
}, { _id: false });

const temporaryDetailsSchema = new mongoose.Schema({
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  workingHours: { type: String, default: '' },
}, { _id: false });

const interviewAvailabilitySchema = new mongoose.Schema({
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  startTime: { type: String, default: '10:00' },
  endTime: { type: String, default: '17:00' },
  timezone: { type: String, default: 'UTC' },
  notes: { type: String, default: '' },
}, { _id: false });

const requisitionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 5, index: true },   // e.g., "Sales Executive / Closer"
  employmentType: {
    type: String,
    enum: ['full_time', 'part_time', 'contract', 'internship', 'temporary'],
    default: 'full_time',
  },
  fullTimeDetails: { type: workingHoursDetailsSchema, default: undefined },
  partTimeDetails: { type: partTimeDetailsSchema, default: undefined },
  contractDetails: { type: contractDetailsSchema, default: undefined },
  internshipDetails: { type: internshipDetailsSchema, default: undefined },
  temporaryDetails: { type: temporaryDetailsSchema, default: undefined },
  // `location` is retained as a readable display value for existing records
  // and public application links. New records derive it from the structured
  // workplace fields below.
  location: { type: String, default: 'Remote' },
  workplaceType: {
    type: String,
    enum: ['onsite', 'hybrid', 'remote'],
    default: 'remote',
    index: true,
  },
  officeLocation: { type: String, default: '' },
  remoteRegion: { type: String, default: '' },
  jobDescription: { type: String, required: true },        // Pasted JD — source for AI generation
  status: {
    type: String,
    // `on_hold` remains accepted for legacy records; new requisitions use
    // the clearer `paused` status exposed in the UI.
    enum: ['open', 'paused', 'closed', 'draft', 'on_hold'],
    default: 'open',
    index: true,
  },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
  pipelineTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'PipelineTemplate' },
  pipelineTemplateName: { type: String },
  // Snapshot of stages at creation, so later template edits don't mutate an open req
  stages: [requisitionStageSchema],
  scorecardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scorecard' },
  hireThreshold: { type: Number, default: 3.5, min: 1, max: 5 },
  maybeThreshold: { type: Number, default: 3.0, min: 1, max: 5 },
  initialScreeningCriteria: [screeningCriteriaItemSchema],
  questionnaire: [questionnaireItemSchema],
  interviewAvailability: { type: interviewAvailabilitySchema, default: undefined },
  applicationDeadline: { type: Date, default: null },
  aiScreeningEnabled: { type: Boolean, default: true },
  closedAt: Date,                                          // Drives retention purge
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Requisition', requisitionSchema);
