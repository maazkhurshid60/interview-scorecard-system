import { isValidId } from '../repositories/ids.js';
import * as candidateRepo from '../repositories/candidateRepository.js';
import * as interviewRepo from '../repositories/interviewRepository.js';
import * as applicationRepo from '../repositories/applicationRepository.js';
import { asyncHandler } from '../utils/helpers.js';
import { getFileAccessUrl } from '../services/fileStorage.js';

/**
 * Which stored file each `kind` refers to: how to look it up (a repository function), and the names of
 * the file fields.
 */
const FILE_KINDS = {
  resume: { find: candidateRepo.findResumeFile, url: 'resumeFileUrl', id: 'resumeFilePublicId', name: 'resumeFileName', size: 'resumeFileSize', mime: 'resumeFileMimeType' },
  artifact: { find: interviewRepo.findArtifactFile, url: 'artifactFileUrl', id: 'artifactFilePublicId', name: 'artifactFileName', size: 'artifactFileSize', mime: 'artifactFileMimeType' },
  'offer-letter': { find: applicationRepo.findOfferLetterFile, url: 'offerLetterUrl', id: 'offerLetterPublicId', name: 'offerLetterFileName', size: 'offerLetterFileSize', mime: 'offerLetterFileMimeType' },
};

/**
 * GET /api/files/:kind/:id
 * Returns a link a signed-in user can open to view a stored file, plus its
 * saved metadata. Stored S3 files are private, so this is where a short-lived
 * signed link is created (it expires after 15 minutes); Cloudinary files
 * simply return their normal link.
 *   kind = resume (id = candidate) | artifact (id = interview) | offer-letter (id = application)
 */
const getFile = asyncHandler(async (req, res) => {
  const kind = FILE_KINDS[req.params.kind];
  if (!kind || !isValidId(req.params.id)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  }

  const record = await kind.find(req.params.id);
  if (!record || !record[kind.url]) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'No file has been uploaded.' });
  }

  const url = await getFileAccessUrl({
    url: record[kind.url],
    publicId: record[kind.id],
    name: record[kind.name],
  });
  return res.json({
    url,
    name: record[kind.name] || null,
    size: record[kind.size] ?? null,
    mimeType: record[kind.mime] || null,
  });
});

export { getFile };
