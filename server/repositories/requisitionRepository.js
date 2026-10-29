// Picks the MongoDB or PostgreSQL version of the requisition repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('requisitionRepository');

export const findById = impl.findById;
export const findByIdWithDepartment = impl.findByIdWithDepartment;
export const findFields = impl.findFields;
export const findPublicView = impl.findPublicView;
export const findByPublicRef = impl.findByPublicRef;
export const listTitlesAndStatuses = impl.listTitlesAndStatuses;
export const listTitles = impl.listTitles;
export const findTitlesAndStages = impl.findTitlesAndStages;
export const findOpenByTitle = impl.findOpenByTitle;
export const list = impl.list;
export const listClosedBefore = impl.listClosedBefore;
export const create = impl.create;
export const save = impl.save;
export const setScorecard = impl.setScorecard;
export const remove = impl.remove;
