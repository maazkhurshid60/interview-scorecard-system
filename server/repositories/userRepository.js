// Picks the MongoDB or PostgreSQL version of the user repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('userRepository');

export const findById = impl.findById;
export const findByEmail = impl.findByEmail;
export const findActiveByEmail = impl.findActiveByEmail;
export const listActiveBrief = impl.listActiveBrief;
export const listAll = impl.listAll;
export const hasOwner = impl.hasOwner;
export const countOwnersExcept = impl.countOwnersExcept;
export const create = impl.create;
export const update = impl.update;
export const remove = impl.remove;
export const savePasswordResetToken = impl.savePasswordResetToken;
export const findByResetToken = impl.findByResetToken;
export const completePasswordReset = impl.completePasswordReset;
