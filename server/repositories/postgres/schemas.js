import { F, defineModel } from './records.js';
import { STAGE_PROGRESS_STATUS, DISPOSITIONS, FINAL_DECISIONS } from '../../utils/constants.js';

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
