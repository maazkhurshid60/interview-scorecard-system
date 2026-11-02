// Picks the MongoDB or PostgreSQL version of the candidate repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('candidateRepository');

export const listPage = impl.listPage;
export const findById = impl.findById;
export const findByEmail = impl.findByEmail;
export const findNamesByIds = impl.findNamesByIds;
export const findIdsBySearch = impl.findIdsBySearch;
export const listEmails = impl.listEmails;
export const isResumeFileInUse = impl.isResumeFileInUse;
export const findResumeFile = impl.findResumeFile;
export const create = impl.create;
export const createMany = impl.createMany;
export const update = impl.update;
export const remove = impl.remove;
