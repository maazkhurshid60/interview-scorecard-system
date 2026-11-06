import { F, defineModel } from './records.js';
import { STAGE_PROGRESS_STATUS, DISPOSITIONS, FINAL_DECISIONS, REVIEW_STATUS, REVIEW_DECISIONS } from '../../utils/constants.js';

/**
 * What the PostgreSQL repositories need to know about each model that holds whole records: its fields, their types, defaults
 * and checks (the same ones the Mongoose models in ../../models/ have), and where each one is stored. See records.js.
 */

export const Candidate = defineModel({
  name: 'Candidate',
  table: 'candidates',
  fields: {
    name: F.string({ required: true }),
    email: F.string({ required: true }),
    phone: F.string({ validate: (value) => !value || /^\d{11}$/.test(value), message: 'Phone number must contain exactly 11 digits.' }),
    resumeFileUrl: F.string(),
    resumeFilePublicId: F.string(),
    resumeFileName: F.string(),
    resumeFileSize: F.number(),
    resumeFileMimeType: F.string(),
    notes: F.string(),
  },
});

export const Application = defineModel({
  name: 'Application',
  table: 'applications',
  fields: {
    candidateId: F.id({ required: true }),
    requisitionId: F.id({ required: true }),
    currentStageKey: F.string(),
    source: F.string({ enum: ['public_link', 'manual'], default: 'manual' }),
    opportunityDuration: F.string(),
    questionnaireAnswers: F.mixed(),
    candidateAvailability: F.nested({ preferredDate: F.string(), startTime: F.string(), endTime: F.string(), notes: F.string(), submittedAt: F.date() }, { json: true }),
    screeningJob: F.nested({
      status: F.string({ enum: ['pending', 'processing', 'completed', 'failed'], col: 'screeningStatus' }),
      attempts: F.number({ default: 0, col: 'screeningAttempts' }),
      lockedAt: F.date({ col: 'screeningLockedAt' }),
      completedAt: F.date({ col: 'screeningCompletedAt' }),
      lastError: F.string({ col: 'screeningLastError' }),
      confirmationEmailSentAt: F.date({ col: 'screeningConfirmationEmailSentAt' }),
    }),
    stageProgress: F.array({
      stageKey: F.string(),
      status: F.string({ enum: STAGE_PROGRESS_STATUS, default: 'pending' }),
      stageAverage: F.number(),
      passed: F.boolean(),
    }, { ids: true, default: [] }),
    initialScreening: F.nested({
      aiScore: F.number(), aiJustification: F.string(), passed: F.boolean(), overridden: F.boolean({ default: false }),
      overriddenBy: F.id(), overrideReason: F.string(),
    }, { json: true }),
    requirements: F.mixed(),
    screeningReview: F.nested({
      status: F.string({ enum: REVIEW_STATUS, col: 'reviewStatus' }),
      aiScore: F.number({ col: 'reviewAiScore' }),
      aiRecommendation: F.string({ enum: REVIEW_DECISIONS, col: 'reviewAiRecommendation' }),
      decision: F.string({ enum: REVIEW_DECISIONS, col: 'reviewDecision' }),
      reason: F.string({ col: 'reviewReason' }),
      reviewedBy: F.id({ col: 'reviewedBy' }),
      reviewedAt: F.date({ col: 'reviewedAt' }),
    }),
    weightedTotal: F.number(),
    allGatesPassed: F.boolean(),
    disposition: F.string({ enum: DISPOSITIONS, default: null }),
    rank: F.number(),
    finalDecision: F.string({ enum: FINAL_DECISIONS, default: null }),
    finalDecisionBy: F.id(),
    rejectionReason: F.string(),
    offerLetterUrl: F.string(),
    offerLetterPublicId: F.string(),
    offerLetterFileName: F.string(),
    offerLetterFileSize: F.number(),
    offerLetterFileMimeType: F.string(),
    offerLetterUploadedAt: F.date(),
    offerLetterTemplateKey: F.string(),
    offerLetterFields: F.mixed(),
    offerLetterDeliveryStatus: F.string({ enum: ['pending', 'sent'] }),
    offerLetterSentAt: F.date(),
    onboardingFormDeliveryStatus: F.string({ enum: ['pending', 'sent'] }),
    onboardingFormSentAt: F.date(),
  },
});

export const Scorecard = defineModel({
  name: 'Scorecard',
  table: 'scorecards',
  fields: {
    requisitionId: F.id({ required: true }),
    generatedByAI: F.boolean({ default: true }),
    stages: F.array({
      stageKey: F.string({ required: true }),
      attributes: F.array({
        attributeId: F.string({ required: true }),
        name: F.string({ required: true }),
        question: F.string(),
        anchor5: F.string(),
        redFlags: F.string(),
      }),
    }, { default: [] }),
  },
});

export const Interview = defineModel({
  name: 'Interview',
  table: 'interviews',
  readOnly: ['publicToken'],
  fields: {
    applicationId: F.id({ required: true }),
    requisitionId: F.id({ required: true }),
    stageKey: F.string({ required: true }),
    meetingMode: F.string({ enum: ['online', 'in_person'], default: 'online' }),
    provider: F.string({ enum: ['google_meet', 'zoom', 'fathom', 'manual'], default: 'google_meet' }),
    meetingUri: F.string(),
    calendarEventId: F.string(),
    meetingStart: F.date(),
    meetingEnd: F.date(),
    conferenceId: F.string(),
    designatedScorerId: F.id(),
    candidateAvailability: F.nested({ preferredDate: F.string(), startTime: F.string(), endTime: F.string(), notes: F.string(), submittedAt: F.date() }, { json: true }),
    consentObtained: F.boolean({ default: false }),
    transcriptText: F.string(),
    transcriptStatus: F.string({ enum: ['none', 'pending', 'ready', 'failed'], default: 'none' }),
    artifactFileUrl: F.string(),
    artifactFilePublicId: F.string(),
    artifactFileName: F.string(),
    artifactFileSize: F.number(),
    artifactFileMimeType: F.string(),
    scores: F.array({
      attributeId: F.string({ required: true }),
      aiScore: F.number(),
      aiJustification: F.string(),
      approvedScore: F.number(),
      overridden: F.boolean({ default: false }),
      overriddenBy: F.id(),
      overrideReason: F.string(),
    }, { default: [] }),
    stageAverage: F.number(),
    status: F.string({ enum: ['pending', 'scheduled', 'transcript_pending', 'scored', 'approved'], default: 'pending' }),
    aiTokensUsed: F.nested({ input: F.number({ col: 'aiInputTokens' }), output: F.number({ col: 'aiOutputTokens' }) }),
    aiCostUsd: F.number(),
  },
});

const STAGE_TYPES = ['resume_screen', 'hr_screen', 'hr_interview', 'task_performance', 'technical', 'simulation', 'final', 'client', 'culture', 'reference', 'background', 'offer'];
const INPUT_TYPES = ['transcript', 'artifact', 'pass_fail', 'status_only', 'manual_rubric'];

export const Requisition = defineModel({
  name: 'Requisition',
  table: 'requisitions',
  readOnly: ['publicToken'],
  fields: {
    title: F.string({ required: true, trim: true, minlength: 5 }),
    employmentType: F.string({ enum: ['full_time', 'part_time', 'contract', 'internship', 'temporary'], default: 'full_time' }),
    fullTimeDetails: F.subdoc({ workingHours: F.string({ default: '' }) }),
    partTimeDetails: F.subdoc({ weeklyHours: F.string({ default: '' }), workingHours: F.string({ default: '' }) }),
    contractDetails: F.subdoc({ duration: F.string({ default: '' }), workingHours: F.string({ default: '' }), paymentRate: F.string({ default: '' }) }),
    internshipDetails: F.subdoc({ duration: F.string({ default: '' }), paidStatus: F.string({ enum: ['paid', 'unpaid'], default: 'paid' }), workingHours: F.string({ default: '' }) }),
    temporaryDetails: F.subdoc({ startDate: F.date({ default: null }), endDate: F.date({ default: null }), workingHours: F.string({ default: '' }) }),
    location: F.string({ default: 'Remote' }),
    workplaceType: F.string({ enum: ['onsite', 'hybrid', 'remote'], default: 'remote' }),
    officeLocation: F.string({ default: '' }),
    remoteRegion: F.string({ default: '' }),
    jobDescription: F.string({ required: true }),
    status: F.string({ enum: ['open', 'paused', 'closed', 'draft', 'on_hold'], default: 'open' }),
    departmentId: F.id(),
    pipelineTemplateId: F.id(),
    pipelineTemplateName: F.string(),
    stages: F.array({
      key: F.string({ required: true }),
      label: F.string({ required: true }),
      stageType: F.string({ required: true, enum: STAGE_TYPES }),
      inputType: F.string({ required: true, enum: INPUT_TYPES }),
      enabled: F.boolean({ default: true }),
      order: F.number({ required: true }),
      weight: F.number({ default: 0 }),
      passThreshold: F.number({ default: 3.0, min: 1, max: 5 }),
    }, { default: [] }),
    scorecardId: F.id(),
    hireThreshold: F.number({ default: 3.5, min: 1, max: 5 }),
    maybeThreshold: F.number({ default: 3.0, min: 1, max: 5 }),
    initialScreeningCriteria: F.array({
      criteria: F.string({ required: true }),
      requirement: F.string({ default: '' }), minimumValue: F.string({ default: '' }), maximumValue: F.string({ default: '' }), relevantField: F.string({ default: '' }),
    }, { default: [] }),
    questionnaire: F.array({
      question: F.string({ required: true }),
      idealAnswer: F.string({ default: '' }),
      requireIdealAnswer: F.boolean({ default: false }),
    }, { default: [] }),
    interviewAvailability: F.subdoc({
      startDate: F.date({ default: null }), endDate: F.date({ default: null }),
      startTime: F.string({ default: '10:00' }), endTime: F.string({ default: '17:00' }), timezone: F.string({ default: 'UTC' }), notes: F.string({ default: '' }),
    }),
    applicationDeadline: F.date({ default: null }),
    aiScreeningEnabled: F.boolean({ default: true }),
    closedAt: F.date(),
    createdBy: F.id(),
  },
});
