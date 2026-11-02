// Picks the MongoDB or PostgreSQL version of the refresh token repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('refreshTokenRepository');

export const create = impl.create;
export const findByHash = impl.findByHash;
export const findById = impl.findById;
export const markUsedIfUnused = impl.markUsedIfUnused;
export const revokeFamily = impl.revokeFamily;
export const revokeAllForUser = impl.revokeAllForUser;
export const removeExpired = impl.removeExpired;
