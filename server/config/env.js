import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Loads the settings from the .env file in the project root into process.env.
 *
 * This file has to be the FIRST thing every entry point imports (index.js, the seed and the scripts). With ES
 * modules all imports are loaded before the rest of a file runs, so a dotenv call written inside index.js would
 * come too late: modules that read process.env while they load would see empty values. Because this file is imported
 * first, it is loaded first.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '..', '.env') });
