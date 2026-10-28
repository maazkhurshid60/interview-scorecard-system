// Picks the MongoDB or PostgreSQL version of the interview repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('interviewRepository');

export const findById = impl.findById;
export const findByApplicationAndStage = impl.findByApplicationAndStage;
export const listByApplication = impl.listByApplication;
export const listByApplicationAndStages = impl.listByApplicationAndStages;
export const listByRequisition = impl.listByRequisition;
export const listSummaries = impl.listSummaries;
export const listFileAndMeetingInfo = impl.listFileAndMeetingInfo;
export const listArtifactFileIds = impl.listArtifactFileIds;
export const isArtifactFileInUse = impl.isArtifactFileInUse;
export const findArtifactFile = impl.findArtifactFile;
export const summarizeAiCost = impl.summarizeAiCost;
export const create = impl.create;
export const save = impl.save;
export const removeByApplication = impl.removeByApplication;
export const removeByApplications = impl.removeByApplications;
export const removeByRequisition = impl.removeByRequisition;
