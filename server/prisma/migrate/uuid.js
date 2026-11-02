/**
 * The UUID an old MongoDB id becomes in PostgreSQL. It is worked out from the id alone, so the same old id always gives the same
 * UUID: a copy can be repeated, and checked, without keeping a list of old and new ids.
 *
 * A MongoDB ObjectId is 12 bytes: 4 bytes of time (in seconds), then 8 bytes (5 that belong to the process that made it, 3 of
 * counter). The UUID is a version 7 one, like the ids the app makes for new records, so old and new records sort together in
 * creation order:
 *
 *   48 bits  the ObjectId's time, in milliseconds (seconds x 1000)
 *    4 bits  the version, 7
 *   12 bits  the first 12 bits of the ObjectId's last 8 bytes
 *    4 bits  the variant, 1000
 *   52 bits  the next 52 bits of those 8 bytes
 *    8 bits  zero
 *
 * Two old ids that sort one way as text sort the same way as UUIDs, and every old id is earlier than any id made after it.
 */

const OBJECT_ID = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{10}00$/;

const dashed = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The UUID (lower case, with dashes) of a 24-character MongoDB id. Throws for anything else. */
export function uuidFromObjectId(objectId) {
  const hex = String(objectId).toLowerCase();
  if (!OBJECT_ID.test(hex)) throw new Error(`"${objectId}" is not a 24-character MongoDB id, so it cannot become a UUID.`);
  const milliseconds = parseInt(hex.slice(0, 8), 16) * 1000;
  const rest = hex.slice(8); // the 16 hex digits (64 bits) after the time
  return dashed(milliseconds.toString(16).padStart(12, '0') + '7' + rest.slice(0, 3) + '8' + rest.slice(3) + '00');
}

/** The 24-character MongoDB id behind a UUID made by `uuidFromObjectId`, or null when the UUID was not made that way. */
export function objectIdFromUuid(uuid) {
  const hex = String(uuid).toLowerCase();
  if (!UUID.test(hex)) return null;
  const flat = hex.replace(/-/g, '');
  const milliseconds = parseInt(flat.slice(0, 12), 16);
  if (milliseconds % 1000 !== 0) return null;
  return milliseconds / 1000 > 0xffffffff ? null : (milliseconds / 1000).toString(16).padStart(8, '0') + flat.slice(13, 16) + flat.slice(17, 30);
}
