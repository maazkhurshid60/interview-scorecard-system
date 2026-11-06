// Picks the MongoDB or PostgreSQL version of the application repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('applicationRepository');

export const findById = impl.findById;
export const findByIdWithCandidate = impl.findByIdWithCandidate;
export const findByCandidateAndRequisition = impl.findByCandidateAndRequisition;
export const listSummariesForCandidates = impl.listSummariesForCandidates;
export const listCandidateIdsForRequisition = impl.listCandidateIdsForRequisition;
export const listRequisitionIdsWithApplications = impl.listRequisitionIdsWithApplications;
export const listAttachedCandidateIds = impl.listAttachedCandidateIds;
export const listOfferLettersForCandidate = impl.listOfferLettersForCandidate;
export const listOfferLettersForRequisition = impl.listOfferLettersForRequisition;
export const countByRequisitionAndDisposition = impl.countByRequisitionAndDisposition;
export const countByDisposition = impl.countByDisposition;
export const countAwaitingReview = impl.countAwaitingReview;
export const pageForRequisition = impl.pageForRequisition;
export const listWithCandidates = impl.listWithCandidates;
export const findOfferLetterFile = impl.findOfferLetterFile;
export const create = impl.create;
export const createMany = impl.createMany;
export const update = impl.update;
export const remove = impl.remove;
export const removeMany = impl.removeMany;
export const removeForRequisition = impl.removeForRequisition;
export const markOnboardingFormPending = impl.markOnboardingFormPending;
export const markOfferLetterSent = impl.markOfferLetterSent;
export const markOnboardingFormSent = impl.markOnboardingFormSent;
export const markConfirmationEmailSent = impl.markConfirmationEmailSent;
export const save = impl.save;
export const listForRanking = impl.listForRanking;
export const setRank = impl.setRank;
export const claimForScreening = impl.claimForScreening;
export const finishScreening = impl.finishScreening;
export const releaseStaleScreenings = impl.releaseStaleScreenings;
export const requeueScreening = impl.requeueScreening;
export const listPendingScreeningIds = impl.listPendingScreeningIds;
