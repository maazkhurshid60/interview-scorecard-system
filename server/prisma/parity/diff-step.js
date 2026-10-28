/**
 * Shows exactly where one step of a parity scenario differs, in full.
 *   node prisma/parity/diff-step.js requisition 1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setup, teardown, runScenario } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [name, number] = process.argv.slice(2);
const handles = await setup();
const scenario = (await import(pathToFileURL(path.join(here, `${name}.parity.js`)).href)).default;
const { differences } = await runScenario(scenario, handles);
const wanted = differences.find((d) => d.where.startsWith(`step ${number}:`));
const walk = (a, b, where = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], `${where}.${key}`);
  } else console.log(`${where}\n   MongoDB : ${JSON.stringify(a)}\n   Postgres: ${JSON.stringify(b)}`);
};
if (wanted) walk(wanted.mongo, wanted.postgres); else console.log('no difference at that step');
await teardown();
void fs;
