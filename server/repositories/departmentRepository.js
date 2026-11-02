// Picks the MongoDB or PostgreSQL version of the department repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('departmentRepository');

export const listWithJobCounts = impl.listWithJobCounts;
export const findById = impl.findById;
export const findByName = impl.findByName;
export const create = impl.create;
export const update = impl.update;
export const countJobs = impl.countJobs;
export const removeAndUnlinkJobs = impl.removeAndUnlinkJobs;
