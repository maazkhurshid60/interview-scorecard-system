import screeningCriteriaConfig from '../constants/screeningCriteria.json';

/** What a candidate picks when none of the job's education levels applies to them (the server accepts the same value). */
export const NO_LISTED_EDUCATION = 'None of these';

/**
 * A public application is scored by the AI in the background after the
 * candidate submits it (the server marks it with `screeningJob`).
 *   pending / processing -> the AI is still working on it
 *   failed               -> it could not be scored automatically; score it by hand
 */
export function isScreeningActive(application) {
  const status = application?.screeningJob?.status;
  return status === 'pending' || status === 'processing';
}

export function isScreeningFailed(application) {
  return application?.screeningJob?.status === 'failed';
}

/** True while an application waits for a person to decide on its review card (a final decision ends the wait). */
export function isWaitingForReview(application) {
  const status = application?.screeningReview?.status;
  return !application?.finalDecision && (status === 'needs_review' || status === 'requirements_not_met');
}

/** The label of the review an application is waiting for. */
export function reviewLabel(application) {
  return application?.screeningReview?.status === 'requirements_not_met' ? 'Requirements not met' : 'Needs review';
}

/** True for a stage the AI scores on a public application: the résumé screen and the HR questionnaire (see services/screeningReview.js). */
export function isScreeningStage(requisition, stageKey) {
  const enabled = (requisition?.stages || []).filter((stage) => stage.enabled);
  const first = enabled.find((stage) => stage.key === 'resume_screen') || enabled[0];
  return stageKey === first?.key || stageKey === 'hr_screen';
}

/** The job's minimum requirements a candidate is asked about on the form (mirrors services/screeningReview.js). */
export function requirementsToAsk(requisition) {
  const criteria = Array.isArray(requisition?.initialScreeningCriteria) ? requisition.initialScreeningCriteria : [];
  const minimumOf = (label) => criteria.find((item) => item?.criteria === label)?.minimumValue || undefined;
  const experience = minimumOf(screeningCriteriaConfig.experience.label);
  return { education: minimumOf(screeningCriteriaConfig.education.label), experience: experience === '0' ? undefined : experience };
}
