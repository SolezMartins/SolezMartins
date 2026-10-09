import './env.js'; // sets ROLE before runtime.ts loads
import '../../../apps/api/src/runtime.js';
import { DerivClient } from '../../../apps/api/src/deriv.js';
import { Ingest } from '../../../apps/api/src/ingest.js';
import { bus } from '../../../apps/api/src/bus.js';
import { persist } from '../../../apps/api/src/persist.js';
const deriv = new DerivClient(); new Ingest(deriv, bus); persist.start(deriv);
console.log('[market-data worker] running: Deriv -> candles -> analysis -> alerts -> Redis');
