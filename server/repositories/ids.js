// Picks the MongoDB or PostgreSQL version of the id checks (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('ids');

export const isValidId = impl.isValidId;
export const isValidIdString = impl.isValidIdString;
export const normalizeId = impl.normalizeId;
