/**
 * Which database each repository uses, set in the environment:
 *
 *   DB_PROVIDER=mongo                  (the default) every repository uses MongoDB
 *   DB_PROVIDER=postgres               every repository uses PostgreSQL
 *   DB_PROVIDER_DEPARTMENT=postgres    one repository uses PostgreSQL while the others keep the DB_PROVIDER choice
 *
 * The per-repository setting exists so each finished PostgreSQL repository can be tried in the real app, screen by screen,
 * while the rest still run on MongoDB. (The two databases hold separate copies of the data, so in that mixed mode only the
 * screen of the repository you switched is reliable; for real use, set DB_PROVIDER for everything.)
 *
 * Each file in this folder (for example departmentRepository.js) is a thin front for one repository: it loads the version
 * the settings pick and re-exports its functions, so controllers and services import the same path whichever database is in
 * use. The two versions must offer exactly the same functions (`npm run check:repositories` compares them).
 */

const VALID = ['mongo', 'postgres'];

/** The repositories, as the names used in DB_PROVIDER_<NAME>. */
export const REPOSITORIES = {
  APPLICATION: 'applicationRepository', AUDIT_LOG: 'auditLogRepository', CANDIDATE: 'candidateRepository', DEPARTMENT: 'departmentRepository',
  IDS: 'ids', INTERVIEW: 'interviewRepository', PIPELINE_TEMPLATE: 'pipelineTemplateRepository', REFRESH_TOKEN: 'refreshTokenRepository',
  REQUISITION: 'requisitionRepository', SCORECARD: 'scorecardRepository', SETTING: 'settingRepository', USER: 'userRepository',
};

function choice(value, setting) {
  const text = String(value).trim().toLowerCase();
  if (!VALID.includes(text)) throw new Error(`${setting} must be "mongo" or "postgres" (it is "${text}").`);
  return text;
}

/** The choice for every repository that has none of its own. */
export const provider = choice(process.env.DB_PROVIDER || 'mongo', 'DB_PROVIDER');

const overrides = {};
for (const [key, value] of Object.entries(process.env)) {
  const match = /^DB_PROVIDER_([A-Z_]+)$/.exec(key);
  if (!match || !value) continue;
  if (!REPOSITORIES[match[1]]) throw new Error(`${key} is not a repository. Use one of: ${Object.keys(REPOSITORIES).map((k) => `DB_PROVIDER_${k}`).join(', ')}.`);
  overrides[match[1]] = choice(value, key);
}

const keyOf = (name) => Object.keys(REPOSITORIES).find((key) => REPOSITORIES[key] === name);

/** Which database the repository with this file name (for example `departmentRepository`) uses. */
export const providerFor = (name) => overrides[keyOf(name)] || provider;

const all = Object.values(REPOSITORIES).map(providerFor);
/** Whether any repository uses PostgreSQL / MongoDB (the app connects to the databases that are needed). */
export const usesPostgres = all.includes('postgres');
export const usesMongo = all.includes('mongo');

/** A one-line description of who uses what, for the start-up log. */
export function describeProviders() {
  const onPostgres = Object.values(REPOSITORIES).filter((name) => name !== 'ids' && providerFor(name) === 'postgres').map((n) => n.replace('Repository', ''));
  const onMongo = Object.values(REPOSITORIES).filter((name) => name !== 'ids' && providerFor(name) === 'mongo').map((n) => n.replace('Repository', ''));
  if (!onPostgres.length) return 'All repositories use MongoDB.';
  if (!onMongo.length) return 'All repositories use PostgreSQL.';
  return `Mixed mode. PostgreSQL: ${onPostgres.join(', ')}. MongoDB: ${onMongo.join(', ')}.`;
}

/** Loads one repository (for example `departmentRepository`) from the folder of the database it uses. */
export async function load(name) {
  const chosen = providerFor(name);
  try {
    return await import(`./${chosen}/${name}.js`);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).replace(/\\/g, '/').includes(`${chosen}/${name}.js`)) {
      throw new Error(`The ${chosen} version of ${name} has not been written yet (repositories/${chosen}/${name}.js).`);
    }
    throw err;
  }
}
