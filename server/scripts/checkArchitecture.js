/**
 * Architecture check: keeps the database behind the repositories.
 *
 *   npm run check:architecture
 *
 * Exits with an error (code 1) when any file outside the data layer
 *  - imports a Mongoose model (`models/...`), or
 *  - imports `mongoose` itself.
 *
 * The data layer is `models/` (schemas), `repositories/` (all queries) and `config/db.js` (the connection). Everything
 * else (routes, controllers, services, middleware, utils, seeds) must go through a repository. This is what keeps the
 * planned move to another database (Postgres + Prisma) down to rewriting the repositories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIPPED_DIRS = new Set(['node_modules', 'logs']);
const DATA_LAYER = [/^models\//, /^repositories\//, /^config\/db\.js$/];

const RULES = [
  { name: 'imports a model', test: /\b(?:from\s+|import\s+)['"][^'"]*\/models\/[^'"]*['"]/ },
  { name: 'imports mongoose', test: /\b(?:from\s+|import\s+)['"]mongoose['"]|require\(['"]mongoose['"]\)/ },
];

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* sourceFiles(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.js')) {
      yield path.join(dir, entry.name);
    }
  }
}

const violations = [];
for (const file of sourceFiles(serverDir)) {
  const relative = path.relative(serverDir, file).split(path.sep).join('/');
  if (DATA_LAYER.some((pattern) => pattern.test(relative))) continue;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return; // comments may mention them
    for (const rule of RULES) {
      if (rule.test.test(line)) violations.push(`${relative}:${index + 1}  ${rule.name}: ${code}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`Architecture check failed: ${violations.length} place(s) reach the database without a repository.\n`);
  violations.forEach((violation) => console.error('  ' + violation));
  console.error('\nMove the query into a repository (server/repositories) and call that instead.');
  process.exit(1);
}
console.log('Architecture check passed: only models/, repositories/ and config/db.js touch the database.');
