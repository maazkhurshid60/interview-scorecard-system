/**
 * Checks what counts as an id on PostgreSQL (a UUID), the ids the app makes for new records, the UUID an old MongoDB id becomes,
 * and how ids and public links are told apart.
 *
 *   npm run test:ids
 *
 * This is not a comparison with MongoDB (an id is a UUID here and a 24-character code there, so the two answer differently on
 * purpose); it states what the PostgreSQL side must say. It needs no database.
 */
import '../../config/env.js';
import crypto from 'node:crypto';

const helpers = await import('../../repositories/postgres/helpers.js');
const ids = await import('../../repositories/postgres/ids.js');
const { uuidFromObjectId, objectIdFromUuid } = await import('../migrate/uuid.js');
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad += 1; console.log(`  ${cond ? 'ok      ' : 'FAILED  '} ${name}${cond ? '' : `   -> ${detail}`}`); };
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sample = '019a4f3c-2b7e-7c01-8f2d-6a1b9c0d4e5f';
const valid = [sample, sample.toUpperCase(), '00000000-0000-0000-0000-000000000000', crypto.randomUUID(), '6ae10381-7000-7000-8000-000000000000'];
const invalid = [7, '7', 0, '0', -1, 1.5, '65a1f3c2e4b0a1d2c3e4f5a6', '', ' ', null, undefined, true, false, NaN, Infinity, {}, [], [sample], { id: sample }, 7n,
  ` ${sample}`, `${sample} `, `${sample}\n`, sample.slice(1), `${sample}0`, sample.replace(/-/g, ''), `{${sample}}`, `urn:uuid:${sample}`, sample.replace('c01', 'g01'), sample.replace(/-/, '_'), 'abc'];

console.log('what is an id (a UUID, in any letter case):');
for (const input of valid) {
  const lower = String(input).toLowerCase();
  ok(`${input} is an id`, helpers.parseId(input) === lower && helpers.castId(input) === lower && ids.isValidId(input) && ids.isValidIdString(input) && ids.normalizeId(input) === lower && helpers.castIdField(input, 'x').value === lower && helpers.idOut(input) === lower);
}

console.log('\nthings that are not ids (each must be refused the same way everywhere):');
for (const input of invalid) {
  const label = typeof input === 'bigint' ? '7n' : (typeof input === 'number' && !Number.isFinite(input) ? String(input) : JSON.stringify(input));
  let error; try { helpers.castId(input, 'applicationId'); } catch (e) { error = e; }
  const field = helpers.castIdField(input, 'applicationId');
  const refused = helpers.parseId(input) === undefined && !ids.isValidId(input) && !ids.isValidIdString(input);
  let normalizeThrows = false; try { ids.normalizeId(input); } catch (e) { normalizeThrows = e.name === 'BSONError'; }
  const nullish = input === null || input === undefined;
  ok(`${label} is refused`, refused && normalizeThrows && error && error.name === 'CastError' && error.path === 'applicationId' && error.kind === 'UUID' && (nullish ? field.value === input : /^Cast to UUID failed/.test(field.problem)), `${error && error.name} ${JSON.stringify(field)}`);
}

console.log('\nthe error carries what the API needs:');
try { helpers.castId('abc', 'candidateId'); } catch (e) { ok('a CastError naming the field (the API answers 400 "Invalid value for candidateId")', e.name === 'CastError' && e.path === 'candidateId' && /candidateId/.test(e.message), e.message); }
try { helpers.castId('abc'); } catch (e) { ok('without a field name it says "_id"', e.path === '_id'); }
ok('a missing value in a link field is left alone (not an error)', helpers.castIdField(undefined, 'x').value === undefined && helpers.castIdField(null, 'x').value === null);
ok('idOut leaves an empty value empty', helpers.idOut(null) === null && helpers.idOut(undefined) === undefined);
ok('compareIds puts ids in creation order', helpers.compareIds('019a0000-0000-7000-8000-000000000001', '019a0000-0000-7000-8000-000000000002') === -1 && helpers.compareIds('b', 'a') === 1 && helpers.compareIds('a', 'a') === 0);

console.log('\nthe ids the app makes for new records:');
const made = Array.from({ length: 200000 }, () => helpers.newId());
ok('every one is a UUID version 7 (variant 10xx)', made.every((id) => UUID_V7.test(id) && helpers.parseId(id) === id));
ok('200,000 made one after the other are all different', new Set(made).size === made.length);
ok('each is larger than the one before it, as text, so sorted they are in creation order', made.every((id, i) => i === 0 || id > made[i - 1]));
ok('they start with the time in milliseconds', Math.abs(parseInt(made[0].replace(/-/g, '').slice(0, 12), 16) - Date.now()) < 60000);
const future = Date.now() + 5 * 60000;
const jumped = helpers.newId(future); const after = helpers.newId(future - 1000); const later = helpers.newId(future - 5000);
ok('when the clock steps back, ids still go up (never smaller than the one before)', after > jumped && later > after, `${jumped} ${after} ${later}`);
const burst = Array.from({ length: 20000 }, () => helpers.newId(future));
ok('20,000 in the same millisecond still go up, and carry on into the next', burst.every((id, i) => i === 0 || id > burst[i - 1]) && new Set(burst).size === burst.length);

console.log('\nthe UUID an old MongoDB id becomes (the same every time, and in the same order):');
const old = '6ae103816e17e1f79b0a205c';
const milliseconds = (BigInt(`0x${old.slice(0, 8)}`) * 1000n).toString(16).padStart(12, '0'); // worked out here on its own, to check the function
const expected = `${milliseconds.slice(0, 8)}-${milliseconds.slice(8, 12)}-7${old.slice(8, 11)}-8${old.slice(11, 14)}-${old.slice(14, 24)}00`;
ok(`${old} becomes ${expected}`, uuidFromObjectId(old) === expected && uuidFromObjectId(old.toUpperCase()) === expected, uuidFromObjectId(old));
ok('it is a UUID version 7 that counts as an id', UUID_V7.test(uuidFromObjectId(old)) && helpers.parseId(uuidFromObjectId(old)) === uuidFromObjectId(old));
ok('it can be turned back into the old id', objectIdFromUuid(uuidFromObjectId(old)) === old);
ok('a UUID the app made is not mistaken for one of these', objectIdFromUuid(sample) === null && objectIdFromUuid(crypto.randomUUID()) === null);
let refused = 0; for (const text of ['', 'abc', old.slice(1), `${old}0`, '65a1f3c2e4b0a1d2c3e4f5aZ', null, undefined, 12]) { try { uuidFromObjectId(text); } catch { refused += 1; } }
ok('anything that is not a 24-character id is refused', refused === 8, refused);
const random = () => { const seconds = crypto.randomInt(0, 2 ** 31); return seconds.toString(16).padStart(8, '0') + crypto.randomBytes(8).toString('hex'); };
const samples = Array.from({ length: 20000 }, random);
const byText = [...samples].sort(); const byUuid = [...samples].sort((a, b) => { const x = uuidFromObjectId(a); const y = uuidFromObjectId(b); return x < y ? -1 : (x > y ? 1 : 0); });
ok('20,000 random old ids sort the same as text and as UUIDs', JSON.stringify(byText) === JSON.stringify(byUuid));
ok('and each turns back into itself, and no two share a UUID', samples.every((hex) => objectIdFromUuid(uuidFromObjectId(hex)) === hex) && new Set(samples.map(uuidFromObjectId)).size === new Set(samples).size);
ok('a small id like 00..0a (used by the tests) works and sorts in order', uuidFromObjectId('00000000000000000000000a') < uuidFromObjectId('00000000000000000000000b') && UUID_V7.test(uuidFromObjectId('00000000000000000000000a')));
const pastSeconds = () => crypto.randomInt(0, Math.floor(Date.now() / 1000) - 1).toString(16).padStart(8, '0') + crypto.randomBytes(8).toString('hex');
const fresh = helpers.newId();
ok('every old id made before now is earlier than an id the app makes now', Array.from({ length: 20000 }, pastSeconds).every((hex) => uuidFromObjectId(hex) < fresh));

console.log('\nids inside JSON lists (not table ids):');
const sub = [helpers.newSubdocId(), helpers.newSubdocId(), helpers.newSubdocId()];
ok('newSubdocId() makes 24-character ids that differ', sub.every((s) => /^[0-9a-f]{24}$/.test(s)) && new Set(sub).size === 3);
ok('newSubdocId(seconds) puts the time first', helpers.newSubdocId(1700000000).startsWith((1700000000).toString(16)));
ok('an existing item id is kept (any letter case, as lower case)', helpers.castSubdocId('65A1F3C2E4B0A1D2C3E4F5A6') === '65a1f3c2e4b0a1d2c3e4f5a6');
ok('a bad item id is not accepted', helpers.castSubdocId('7') === undefined && helpers.castSubdocId(7) === undefined && helpers.castSubdocId(null) === undefined && helpers.castSubdocId(sample) === undefined);

console.log('\npublic links (a random token, or the old 24-character id; never a record\'s own id):');
const token = '254a7786-92cd-4a04-8721-373db88311ca';
for (const [input, kind, value] of [[token, 'token', token], [token.toUpperCase(), 'token', token], ['6ae103816e17e1f79b0a205c', 'legacy', '6ae103816e17e1f79b0a205c'], ['6AE103816E17E1F79B0A205C', 'legacy', '6ae103816e17e1f79b0a205c']]) {
  const parsed = helpers.parsePublicRef(input);
  ok(`${input} is a public link (${kind})`, parsed && parsed.kind === kind && parsed.value === value && ids.isValidPublicRef(input), JSON.stringify(parsed));
}
for (const input of ['1', 1, '7', 'abc', '', null, undefined, {}, [], '254a7786-92cd-4a04-8721-373db88311c', '254a7786-92cd-4a04-8721-373db88311caa', '6ae103816e17e1f79b0a205', 'zzzzzzzzzzzzzzzzzzzzzzzz', ` ${token}`]) {
  ok(`${JSON.stringify(input)} is not a public link`, helpers.parsePublicRef(input) === null && !ids.isValidPublicRef(input));
}

console.log(bad ? `\n${bad} CHECK(S) FAILED` : '\nALL CHECKS PASS');
process.exit(bad ? 1 : 0);
