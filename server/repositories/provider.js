/**
 * Which database the app uses, set by DB_PROVIDER in the environment:
 *
 *   DB_PROVIDER=mongo      (the default) the repositories in ./mongo
 *   DB_PROVIDER=postgres   the repositories in ./postgres
 *
 * Each file in this folder (for example departmentRepository.js) is a thin front for one repository: it loads the version
 * the setting picks and re-exports its functions, so controllers and services import the same path whichever database is
 * in use. The two versions must offer exactly the same functions (`npm run check:repositories` compares them).
 */

export const provider = String(process.env.DB_PROVIDER || 'mongo').trim().toLowerCase();

if (!['mongo', 'postgres'].includes(provider)) {
  throw new Error(`DB_PROVIDER must be "mongo" or "postgres" (it is "${provider}").`);
}

/** Loads one repository (for example `departmentRepository`) from the folder of the chosen database. */
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
