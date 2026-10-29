/**
 * Checks what counts as an id on PostgreSQL, and how ids and public links are told apart.
 *
 *   npm run test:ids
 *
 * This is not a comparison with MongoDB (an id is a number here and a 24-character code there, so the two answer differently on
 * purpose); it states what the PostgreSQL side must say. It needs no database.
 */
import '../../config/env.js';

const helpers = await import('../../repositories/postgres/helpers.js');
const ids = await import('../../repositories/postgres/ids.js');
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad += 1; console.log(`  ${cond ? 'ok      ' : 'FAILED  '} ${name}${cond ? '' : `   -> ${detail}`}`); };

const valid = [[1, 1], ['1', 1], ['7', 7], [42, 42], [2147483647, 2147483647], ['2147483647', 2147483647], ['1234567890', 1234567890]];
const invalid = [0, '0', '07', '007', -1, '-1', 1.5, '1.5', '1e3', 1000.5, ' 7', '7 ', '7\n', 'abc', '', null, undefined, true, false, '65a1f3c2e4b0a1d2c3e4f5a6', 2147483648, '2147483648', '99999999999', NaN, Infinity, {}, [], [7], '+7', '0x10', 7n, '٧'];

console.log('numbers and digits that are ids:');
for (const [input, number] of valid) {
  ok(`${JSON.stringify(input)} is the id ${number}`, helpers.parseId(input) === number && helpers.castId(input) === number && ids.isValidId(input) && ids.isValidIdString(input) && ids.normalizeId(input) === String(number) && helpers.castIdField(input, 'x').value === number);
}

console.log('\nthings that are not ids (each must be refused the same way everywhere):');
for (const input of invalid) {
  const label = typeof input === 'bigint' ? '7n' : (Number.isNaN(input) ? 'NaN' : (input === Infinity ? 'Infinity' : JSON.stringify(input)));
  let error; try { helpers.castId(input, 'applicationId'); } catch (e) { error = e; }
  const field = helpers.castIdField(input, 'applicationId');
  const refused = helpers.parseId(input) === undefined && !ids.isValidId(input) && !ids.isValidIdString(input);
  let normalizeThrows = false; try { ids.normalizeId(input); } catch (e) { normalizeThrows = e.name === 'BSONError'; }
  const nullish = input === null || input === undefined;
  ok(`${label} is refused`, refused && normalizeThrows && error && error.name === 'CastError' && error.path === 'applicationId' && error.kind === 'Number' && (nullish ? field.value === input : /^Cast to Number failed/.test(field.problem)), `${error && error.name} ${JSON.stringify(field)}`);
}

console.log('\nthe error carries what the API needs:');
try { helpers.castId('abc', 'candidateId'); } catch (e) { ok('a CastError naming the field (the API answers 400 "Invalid value for candidateId")', e.name === 'CastError' && e.path === 'candidateId' && /candidateId/.test(e.message), e.message); }
try { helpers.castId('abc'); } catch (e) { ok('without a field name it says "_id"', e.path === '_id'); }
ok('a missing value in a link field is left alone (not an error)', helpers.castIdField(undefined, 'x').value === undefined && helpers.castIdField(null, 'x').value === null);

console.log('\nids inside JSON lists:');
const sub = [helpers.newSubdocId(), helpers.newSubdocId(), helpers.newSubdocId()];
ok('newSubdocId() makes 24-character ids that differ', sub.every((s) => /^[0-9a-f]{24}$/.test(s)) && new Set(sub).size === 3);
ok('newSubdocId(seconds) puts the time first', helpers.newSubdocId(1700000000).startsWith((1700000000).toString(16)));
ok('an existing item id is kept (any letter case, as lower case)', helpers.castSubdocId('65A1F3C2E4B0A1D2C3E4F5A6') === '65a1f3c2e4b0a1d2c3e4f5a6');
ok('a bad item id is not accepted', helpers.castSubdocId('7') === undefined && helpers.castSubdocId(7) === undefined && helpers.castSubdocId(null) === undefined);
ok('idOut gives text and leaves an empty value empty', helpers.idOut(7) === '7' && helpers.idOut('7') === '7' && helpers.idOut(null) === null && helpers.idOut(undefined) === undefined);
ok('MAX_ID is the largest 4-byte integer', helpers.MAX_ID === 2147483647);

console.log('\npublic links (a random token, or the old 24-character id; never the plain number):');
const token = '254a7786-92cd-4a04-8721-373db88311ca';
const accepted = [[token, 'token', token], [token.toUpperCase(), 'token', token], ['6ae103816e17e1f79b0a205c', 'legacy', '6ae103816e17e1f79b0a205c'], ['6AE103816E17E1F79B0A205C', 'legacy', '6ae103816e17e1f79b0a205c']];
for (const [input, kind, value] of accepted) {
  const parsed = helpers.parsePublicRef(input);
  ok(`${input} is a public link (${kind})`, parsed && parsed.kind === kind && parsed.value === value && ids.isValidPublicRef(input), JSON.stringify(parsed));
}
for (const input of ['1', 1, '7', 'abc', '', null, undefined, {}, [], '254a7786-92cd-4a04-8721-373db88311c', '254a7786-92cd-4a04-8721-373db88311caa', '6ae103816e17e1f79b0a205', 'zzzzzzzzzzzzzzzzzzzzzzzz', ` ${token}`]) {
  ok(`${JSON.stringify(input)} is not a public link`, helpers.parsePublicRef(input) === null && !ids.isValidPublicRef(input));
}

console.log(bad ? `\n${bad} CHECK(S) FAILED` : '\nALL CHECKS PASS');
process.exit(bad ? 1 : 0);
