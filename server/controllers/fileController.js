const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const Application = require('../models/Application');
const { asyncHandler } = require('../utils/helpers');
const { getFileAccessUrl } = require('../services/fileStorage');

/**
 * Which stored file each `kind` refers to: the model it lives on, and the
 * names of that model's file fields.
 */
const FILE_KINDS = {
  resume: { model: Candidate, url: 'resumeFileUrl', id: 'resumeFilePublicId', name: 'resumeFileName', size: 'resumeFileSize', mime: 'resumeFileMimeType' },
  artifact: { model: Interview, url: 'artifactFileUrl', id: 'artifactFilePublicId', name: 'artifactFileName', size: 'artifactFileSize', mime: 'artifactFileMimeType' },
  'offer-letter': { model: Application, url: 'offerLetterUrl', id: 'offerLetterPublicId', name: 'offerLetterFileName', size: 'offerLetterFileSize', mime: 'offerLetterFileMimeType' },
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
  if (!kind || !mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  }

  const record = await kind.model.findById(req.params.id).select(Object.values(kind).filter((v) => typeof v === 'string').join(' '));
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

module.exports = { getFile };
