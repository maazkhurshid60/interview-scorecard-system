import api from '../hooks/useApi';

/**
 * Opens a stored file (résumé, interview file) in a new tab.
 *
 * Production files are private, so the server hands out a short-lived link each
 * time a file is opened instead of the page holding a permanent one. The tab is
 * opened straight away (inside the click) so browsers do not treat it as a
 * pop-up, then pointed at the link once the server answers.
 *
 * @param {'resume'|'artifact'|'offer-letter'} kind
 * @param {string} id - Candidate id (resume), interview id (artifact) or application id (offer-letter).
 */
export async function openStoredFile(kind, id) {
  const tab = window.open('', '_blank');
  try {
    const { data } = await api.get(`/files/${kind}/${id}`);
    if (!data?.url) throw new Error('No file link returned.');
    if (tab) {
      tab.opener = null;
      tab.location.href = data.url;
    } else {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  } catch {
    // The API client already shows the error message; just close the empty tab.
    tab?.close();
  }
}
