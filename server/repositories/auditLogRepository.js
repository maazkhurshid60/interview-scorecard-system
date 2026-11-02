// Picks the MongoDB or PostgreSQL version of the audit log repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('auditLogRepository');

export const record = impl.record;
export const search = impl.search;
export const removeForApplication = impl.removeForApplication;
export const removeForApplications = impl.removeForApplications;
export const removeForRequisition = impl.removeForRequisition;
