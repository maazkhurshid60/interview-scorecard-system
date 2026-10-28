/**
 * Repository parity check: the MongoDB and PostgreSQL versions of every repository must offer exactly the same functions,
 * because controllers and services call them without knowing which database is behind them.
 *
 *   npm run check:repositories             shows what each version has (and what the Postgres side still lacks)
 *   npm run check:repositories -- --strict exits with an error if the two do not match exactly
 *
 * While the Postgres versions are being written, the plain run is a progress report; `--strict` is for when they are done.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositories = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'repositories');
const strict = process.argv.includes('--strict');
const names = fs.readdirSync(path.join(repositories, 'mongo')).filter((f) => /Repository\.js$|^ids\.js$/.test(f)).map((f) => f.replace(/\.js$/, '')).sort();

const exportsOf = async (folder, name) => {
  const file = path.join(repositories, folder, `${name}.js`);
  if (!fs.existsSync(file)) return null;
  return Object.keys(await import(pathToFileURL(file).href)).sort();
};

let missingFiles = 0; let mismatched = 0; let matching = 0;
console.log(`${'repository'.padEnd(30)}${'mongo'.padStart(7)}${'postgres'.padStart(10)}  status`);
for (const name of names) {
  const mongo = await exportsOf('mongo', name);
  const postgres = await exportsOf('postgres', name);
  let status;
  if (!postgres) { status = 'not written yet'; missingFiles += 1; }
  else {
    const lacking = mongo.filter((n) => !postgres.includes(n)); const extra = postgres.filter((n) => !mongo.includes(n));
    if (!lacking.length && !extra.length) { status = 'same functions'; matching += 1; }
    else { status = `DIFFERENT${lacking.length ? ` (postgres lacks: ${lacking.join(', ')})` : ''}${extra.length ? ` (postgres has extra: ${extra.join(', ')})` : ''}`; mismatched += 1; }
  }
  console.log(`${name.padEnd(30)}${String(mongo.length).padStart(7)}${String(postgres ? postgres.length : '-').padStart(10)}  ${status}`);
}
console.log(`\n${matching} of ${names.length} match, ${missingFiles} not written yet, ${mismatched} different.`);
if (strict && (missingFiles || mismatched)) process.exit(1);
