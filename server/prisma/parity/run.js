/**
 * Runs the parity scenarios: each repository must behave exactly the same on MongoDB and on PostgreSQL.
 *
 *   npm run parity                  runs every scenario
 *   npm run parity -- department    runs one
 *
 * Needs a local Postgres (DATABASE_URL) and the MongoDB in MONGODB_URI. Uses scratch databases only; see harness.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runScenario, setup, teardown } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const available = fs.readdirSync(here).filter((f) => f.endsWith('.parity.js')).map((f) => f.replace('.parity.js', '')).sort();
const names = wanted.length ? wanted : available;
for (const name of names) if (!available.includes(name)) { console.error(`No scenario "${name}". Available: ${available.join(', ')}`); process.exit(2); }

const handles = await setup();
let failed = 0;
try {
  for (const name of names) {
    const scenario = (await import(pathToFileURL(path.join(here, `${name}.parity.js`)).href)).default;
    const { lines, differences } = await runScenario(scenario, handles);
    console.log(`\n=== ${scenario.repository}: ${lines.length} steps`);
    for (const l of lines) console.log(`  ${l.same ? 'same     ' : 'DIFFERENT'}  ${l.name}${l.same && l.error ? '   (both raised the same error)' : ''}`);
    if (differences.length) {
      failed += differences.length;
      console.log(`\n${differences.length} DIFFERENCE(S):`);
      for (const d of differences) console.log(`  X ${d.where}\n      MongoDB : ${JSON.stringify(d.mongo)?.slice(0, 400)}\n      Postgres: ${JSON.stringify(d.postgres)?.slice(0, 400)}`);
    } else console.log(`\nPASS: ${scenario.repository} gives identical results, identical errors and leaves identical data on both databases.`);
  }
} finally {
  await teardown();
}
process.exit(failed ? 1 : 0);
