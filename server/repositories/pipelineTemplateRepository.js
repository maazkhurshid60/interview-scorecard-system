// Picks the MongoDB or PostgreSQL version of the pipeline template repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('pipelineTemplateRepository');

export const listAll = impl.listAll;
export const findById = impl.findById;
export const findDefault = impl.findDefault;
export const create = impl.create;
export const update = impl.update;
export const makeDefault = impl.makeDefault;
export const remove = impl.remove;
