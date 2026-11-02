// Picks the MongoDB or PostgreSQL version of the scorecard repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('scorecardRepository');

export const findById = impl.findById;
export const findByRequisition = impl.findByRequisition;
export const create = impl.create;
export const save = impl.save;
export const remove = impl.remove;
export const removeByRequisition = impl.removeByRequisition;
