/**
 * Hands-on try-out of the PostgreSQL department repository, for testing by eye.
 *
 *   npm run try:department
 *
 * It resets the scratch database (ownerstalent_parity, never your real data), puts a few departments and jobs in it, then
 * performs the operations one at a time and prints what each one returned. The scratch data stays afterwards, so you can
 * open pgAdmin (Databases > ownerstalent_parity > Schemas > public > Tables > departments / requisitions > View/Edit Data >
 * All Rows) and see exactly what each step did. Run it again any time: it starts from the same data.
 */
import { oid, resetAndSeed, setup, teardown } from './harness.js';
import scenario, { ID } from './department.parity.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await setup();
await resetAndSeed(scenario.seed());
const repo = await import(pathToFileURL(path.join(here, '..', '..', 'repositories', 'postgres', 'departmentRepository.js')).href);

const show = (value) => JSON.stringify(value, null, 2).split('\n').map((l) => '    ' + l).join('\n');
let n = 0;
async function step(title, fn) {
  n += 1;
  console.log(`\n${n}. ${title}`);
  try { console.log(show(await fn())); } catch (error) { console.log(`    ERROR (${error.name}): ${error.message}`); }
}

console.log('Scratch Postgres database ready with 10 departments and 8 jobs.');
await step('List all departments with their job counts (sorted by name; note "Zeta" comes before "alpha")', () => repo.listWithJobCounts());
await step('Create "  Marketing  " (with spaces; they are trimmed)', () => repo.create({ name: '  Marketing  ', description: '  Grows the brand  ', createdBy: ID.user }));
await step('Create "Marketing" again (must fail: already exists)', () => repo.create({ name: 'Marketing' }));
await step('Find "marketing" in other case (finds Marketing)', () => repo.findByName('marketing'));
await step('Find "100%" (must find nothing: % is not a wildcard)', () => repo.findByName('100%'));
await step('Rename Engineering to "Platform"', () => repo.update(ID.eng, { name: 'Platform' }));
await step('Count the jobs of Platform (was Engineering): 4 jobs, 2 open', () => repo.countJobs(ID.eng));
await step('Look up with an invalid id (must fail: invalid id)', () => repo.findById('not-an-id'));
await step('Delete Platform (its 4 jobs lose their department, they are not deleted)', () => repo.removeAndUnlinkJobs(ID.eng));
await step('List again: Platform is gone', () => repo.listWithJobCounts());
console.log('\nDone. Now look at the "departments" and "requisitions" tables in pgAdmin (database ownerstalent_parity).');
void oid;
await teardown();
