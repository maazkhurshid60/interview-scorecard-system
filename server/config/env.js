import dns from 'dns';
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

/**
 * DNS_SERVERS (optional, comma-separated) replaces the servers Node uses for its own DNS queries. mongodb+srv:// addresses
 * depend on those queries, and on some Windows machines Node falls back to 127.0.0.1 instead of the system's servers, which
 * fails with "querySrv ECONNREFUSED". Leave it unset unless you see that error.
 */
const dnsServers = (process.env.DNS_SERVERS || '').split(',').map((server) => server.trim()).filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);
