import * as applicationRepo from '../repositories/applicationRepository.js';
import { ValidationError } from '../utils/errors.js';
import { REVIEW_WAITING, SCREENING_CRITERIA } from '../utils/constants.js';

/**
 * How a public application gets from the form to a person's decision.
 *
 * Anthropic's Usage Policy (effective 12 November 2026) treats screening, ranking, advancing or rejecting candidates as
 * high-risk: a qualified person must review the AI's output, with authority to change it, before it is used, and the
 * candidate must be told AI was used. So the AI never decides here:
 *
 *   1. Fixed checks: what the candidate stated is compared by code (no AI) with the job's minimum requirements. One who
 *      does not meet them waits for a person as `requirements_not_met`; nobody is rejected by the check, and the AI is not used.
 *   2. AI screening (services/applicationProcessor.js): proposes scores for the résumé and the questionnaire, and stops
 *      there. The application waits for a person as `needs_review`, in order of the AI's score.
 *   3. Review (the screening review endpoints in controllers/scoringController.js): a reviewer sees the evidence and decides,
 *      one candidate at a time. There is deliberately no way to approve several at once. Their decision is what moves or
 *      rejects the candidate, and it counts over the stages' score gates (`reviewedStageGates`).
 */

/** What a candidate picks when none of the job's education levels applies to them. */
const NO_LISTED_EDUCATION = 'None of these';

const yearsLabel = (years) => `${years} ${years === '1' ? 'year' : 'years'}`;

/** The stages the AI scores for a public application: the résumé screen and, when it is enabled, the HR questionnaire. */
function getScreeningStages(requisition) {
  const enabled = (requisition.stages || []).filter((stage) => stage.enabled);
  // Public applications always begin with the required résumé screen, even for an older pipeline template.
  const first = enabled.find((stage) => stage.key === 'resume_screen') || enabled[0] || requisition.stages?.[0];
  const hr = enabled.find((stage) => stage.key === 'hr_screen');
  return hr && hr.key !== first?.key ? [first, hr] : [first].filter(Boolean);
}

/**
 * The reviewer's decision as the gate result of each screening stage, for scoringEngine: `{ stageKey: true|false }`.
 * Empty until a reviewer has decided, so the stages' score gates apply as usual.
 */
function reviewedStageGates(application, requisition) {
  const decision = application.screeningReview?.decision;
  if (!decision) return {};
  return Object.fromEntries(getScreeningStages(requisition).map((stage) => [stage.key, decision === 'advance']));
}

/**
 * A screening stage waiting for a person is decided on the candidate's review card, where the reviewer, the AI's
 * recommendation and the reason are recorded together. Until then it can be neither approved on its own nor scored again.
 */
async function assertNotWaitingForReview(interview, requisition) {
  if (!getScreeningStages(requisition).some((stage) => stage.key === interview.stageKey)) return;
  const application = await applicationRepo.findById(interview.applicationId);
  if (REVIEW_WAITING.includes(application?.screeningReview?.status)) {
    const err = new ValidationError(['status'], 'This candidate is waiting for review. Please decide on their review card.');
    err.statusCode = 409;
    throw err;
  }
}

/**
 * The job's minimum requirements a candidate has to state something about. A maximum is not checked: turning people
 * down for having too much experience is a well-known stand-in for age.
 * @returns {{education?: string, experience?: string}} the minimum of each one that applies
 */
function requirementsToAsk(requisition) {
  const criteria = Array.isArray(requisition.initialScreeningCriteria) ? requisition.initialScreeningCriteria : [];
  const minimumOf = (label) => criteria.find((item) => item?.criteria === label)?.minimumValue || undefined;
  const experience = minimumOf(SCREENING_CRITERIA.experience.label);
  return {
    education: minimumOf(SCREENING_CRITERIA.education.label),
    experience: experience === '0' ? undefined : experience, // no experience needed: nothing to ask
  };
}

/**
 * Compares what a candidate stated with the job's minimum requirements. This is plain code: no AI is involved.
 * @param {object} requisition
 * @param {{education?: string, experienceYears?: string}} [stated]
 * @returns {{answers: object, checks: Array<{criteria:string, required:string, answered:string, met:boolean}>}|null} null when the job has none
 * @throws {ValidationError} when a requirement was not answered with one of the listed choices
 */
function checkRequirements(requisition, stated) {
  const { education, experience } = requirementsToAsk(requisition);
  if (!education && !experience) return null;

  const { options: levels } = SCREENING_CRITERIA.education;
  const { options: years } = SCREENING_CRITERIA.experience;
  const answers = {};
  const checks = [];

  if (education) {
    answers.education = String(stated?.education || '');
    if (!levels.includes(answers.education) && answers.education !== NO_LISTED_EDUCATION) {
      throw new ValidationError(['requirementAnswers.education'], 'Please select your highest level of education.');
    }
    checks.push({
      criteria: SCREENING_CRITERIA.education.label,
      required: `${education} or higher`,
      answered: answers.education,
      met: levels.indexOf(answers.education) >= levels.indexOf(education),
    });
  }

  if (experience) {
    answers.experienceYears = String(stated?.experienceYears || '');
    if (!years.includes(answers.experienceYears)) {
      throw new ValidationError(['requirementAnswers.experienceYears'], 'Please select your years of experience.');
    }
    checks.push({
      criteria: SCREENING_CRITERIA.experience.label,
      required: `At least ${yearsLabel(experience)}`,
      answered: yearsLabel(answers.experienceYears),
      met: years.indexOf(answers.experienceYears) >= years.indexOf(experience),
    });
  }

  return { answers, checks };
}

/** True when a fixed check failed. */
function hasUnmetRequirement(requirements) {
  return Boolean(requirements?.checks?.some((check) => !check.met));
}

export { NO_LISTED_EDUCATION, getScreeningStages, reviewedStageGates, assertNotWaitingForReview, requirementsToAsk, checkRequirements, hasUnmetRequirement };
