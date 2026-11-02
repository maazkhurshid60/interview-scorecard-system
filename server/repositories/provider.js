/**
 * Which database the repositories use, set in the environment:
 *
 *   DB_PROVIDER=mongo       (the default) every repository uses MongoDB
 *   DB_PROVIDER=postgres    every repository uses PostgreSQL
 *
 * Each file in this folder (for example departmentRepository.js) is a thin front for one repository: it loads the version
 * the setting picks and re-exports its functions, so controllers and services import the same path whichever database is in
 * use. The two versions must offer exactly the same functions (`npm run check:repositories` compares them).
 */

const VALID = ['mongo', 'postgres'];

const text = String(process.env.DB_PROVIDER || 'mongo').trim().toLowerCase();
if (!VALID.includes(text)) throw new Error(`DB_PROVIDER must be "mongo" or "postgres" (it is "${text}").`);

/** The database every repository uses. */
export const provider = text;

/** Whether the app has to connect to PostgreSQL / MongoDB. */
export const usesPostgres = provider === 'postgres';
export const usesMongo = provider === 'mongo';

/** A one-line description for the start-up log. */
export const describeProviders = () => (usesPostgres ? 'All repositories use PostgreSQL.' : 'All repositories use MongoDB.');

/** Loads one repository (for example `departmentRepository`) from the folder of the database in use. */
export async function load(name) {
  try {
    return await import(`./${provider}/${name}.js`);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).replace(/\\/g, '/').includes(`${provider}/${name}.js`)) {
      throw new Error(`The ${provider} version of ${name} has not been written yet (repositories/${provider}/${name}.js).`);
    }
    throw err;
  }
}
