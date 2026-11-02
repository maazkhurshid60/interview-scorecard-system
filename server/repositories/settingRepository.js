// Picks the MongoDB or PostgreSQL version of the setting repository (see provider.js). Both versions offer exactly these functions.
import { load } from './provider.js';

const impl = await load('settingRepository');

export const listAll = impl.listAll;
export const findByKey = impl.findByKey;
export const getValue = impl.getValue;
export const getValues = impl.getValues;
export const updateValue = impl.updateValue;
export const createIfMissing = impl.createIfMissing;
export const addToList = impl.addToList;
export const incrementEntry = impl.incrementEntry;
