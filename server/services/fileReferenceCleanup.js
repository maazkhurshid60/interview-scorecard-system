import * as candidateRepo from '../repositories/candidateRepository.js';
import Interview from '../models/Interview.js';
import { deleteFile } from './fileStorage.js';

// A file can be shared by legacy public applications. Delete it only after
// every profile and interview has stopped referring to it.
async function destroyFileIfUnreferenced(publicId) {
  if (!publicId) return false;
  const [candidateReference, interviewReference] = await Promise.all([
    candidateRepo.isResumeFileInUse(publicId),
    Interview.exists({ artifactFilePublicId: publicId }),
  ]);
  if (candidateReference || interviewReference) return false;
  await deleteFile(publicId);
  return true;
}

export { destroyFileIfUnreferenced };
