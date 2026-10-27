import Setting from '../models/Setting.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about settings: admin-editable values (thresholds, retention days,
 * model tiers, credentials, spend counters), each stored under a unique `key`. Only this file (and the model)
 * knows where they live.
 */

/** Every setting, sorted by key. */
export async function listAll() {
  return plain(await Setting.find().sort({ key: 1 }).lean());
}

/** One setting by key, or null. */
export async function findByKey(key) {
  return plain(await Setting.findOne({ key }).lean());
}

/** The value stored under `key`, or `fallback` when there is no such setting (or its value is empty). */
export async function getValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return plain(setting?.value) ?? fallback;
}

/** The values of several settings in one round trip, as `{ key: value }`. Keys that do not exist are left out. */
export async function getValues(keys) {
  const settings = await Setting.find({ key: { $in: keys } }).lean();
  const values = {};
  settings.forEach((setting) => { values[setting.key] = plain(setting.value); });
  return values;
}

/**
 * Sets the value of an existing setting.
 * @returns {Promise<{oldValue: any, setting: object} | null>} the previous value and the updated setting, or null
 *   when there is no setting with that key.
 */
export async function updateValue(key, value) {
  const setting = await Setting.findOne({ key });
  if (!setting) return null;
  const oldValue = plain(setting.value);
  setting.value = value;
  setting.updatedAt = new Date();
  await setting.save();
  return { oldValue, setting: plain(setting) };
}

/** Creates the setting if it does not exist yet; an existing one is left untouched. */
export async function createIfMissing(key, value, description) {
  return plain(await Setting.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, value, description, updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean());
}

/** Adds `item` to the list stored under `key` unless it is already there (creating the setting if needed). */
export async function addToList(key, item) {
  await Setting.findOneAndUpdate(
    { key },
    { $addToSet: { value: item }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}

/** Atomically adds `amount` to one entry of the object stored under `key` (creating the setting and entry if needed). */
export async function incrementEntry(key, entry, amount) {
  await Setting.findOneAndUpdate(
    { key },
    { $inc: { [`value.${entry}`]: amount }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}
