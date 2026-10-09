import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { runBacktest, type BtRules, type Costs } from '@dmi/strategies';
import type { Candle } from '@dmi/types';
import { REDIS_URL, distributed } from './runtime.js';
const conn = () => new Redis(REDIS_URL!, { maxRetriesPerRequest: null });
let queue: Queue | undefined, events: QueueEvents | undefined;
/** Single-process mode runs inline. Distributed mode sends the CPU-heavy run to a BullMQ worker (candles are loaded by the API). */
export async function backtestJob(candles: Candle[], rules: BtRules, tfSec: number, costs?: Costs) {
  if (!distributed) return runBacktest(candles, rules, tfSec, costs);
  queue ??= new Queue('backtest', { connection: conn(), defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50, attempts: 1 } });
  events ??= new QueueEvents('backtest', { connection: conn() });
  const job = await queue.add('run', { candles, rules, tfSec, costs });
  return job.waitUntilFinished(events, 30_000) as Promise<ReturnType<typeof runBacktest>>;
}
export function startBacktestWorker() {
  return new Worker('backtest', async job => runBacktest(job.data.candles, job.data.rules, job.data.tfSec, job.data.costs), { connection: conn(), concurrency: 2 });
}
