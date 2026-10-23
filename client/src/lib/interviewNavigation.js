/**
 * How the job page and the interview page navigate between each other.
 *
 * The browser keeps a list of visited pages (the history). Going "back to the job" from an interview must
 * REMOVE the interview from that list, not add the job page on top of it. If it were added, the job page's
 * own Back button would step back into the interview, and the two pages would send you to each other forever.
 *
 *   job page  --opens-->  interview     history: [..., job, interview]       (the job page passes { fromJob })
 *   interview --Back-->   job           history: [..., job]                  (one step back, so Back works as expected)
 *   interview --next stage--> interview history: [..., job, next interview]  (replaces, so Back is still one step)
 *
 * When the interview was not opened from the job page (a typed or shared link), there is nothing to step back
 * to, so the job page replaces the interview in the history instead.
 */

/** The state a link to an interview carries when it is opened from the job page. */
export const fromJobState = (requisitionId) => ({ fromJob: String(requisitionId) });

/** The interview page's "Back to <job>" button. */
export function goBackToJob(navigate, location, requisitionId) {
  if (location?.state?.fromJob === String(requisitionId)) {
    navigate(-1);
  } else {
    navigate(`/requisitions/${requisitionId}`, { replace: true });
  }
}

/** Moving from one interview to another (next stage, another stage in the stepper): replaces, keeps the state. */
export function openInterviewReplacing(navigate, location, interviewId) {
  navigate(`/interview/${interviewId}`, { replace: true, state: location?.state });
}
