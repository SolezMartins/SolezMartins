import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) }); // repo-root .env (must be imported before anything reads process.env)
/** all = everything in one process, in-memory bus, no Redis (default). api | ingest | worker = split processes, Redis required. */
export const ROLE = process.env.ROLE || 'all';
export const REDIS_URL = process.env.REDIS_URL;
if (!['all', 'api', 'ingest', 'worker'].includes(ROLE)) throw new Error(`Invalid ROLE "${ROLE}" (all | api | ingest | worker)`);
if (ROLE !== 'all' && !REDIS_URL) throw new Error(`ROLE=${ROLE} requires REDIS_URL. Use ROLE=all to run without Redis.`);
export const distributed = ROLE !== 'all';
