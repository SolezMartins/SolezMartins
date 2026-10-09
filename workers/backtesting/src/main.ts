import './env.js';
import '../../../apps/api/src/runtime.js';
import { startBacktestWorker } from '../../../apps/api/src/jobs.js';
startBacktestWorker(); console.log('[backtest worker] running');
