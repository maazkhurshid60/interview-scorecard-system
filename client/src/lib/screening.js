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
