/**
 * Outcome tracking for auto-journaled trade signals. Pure functions (no I/O) so the rules can be unit-tested; ingest.ts feeds them live ticks.
 *
 * Lifecycle of a signal entry:  pending (limit order waiting at the zone midpoint)  ->  filled  ->  done (win / loss / expired)
 *                               pending -> done (missed: target ran without a pullback, or no fill within the time limit)
 * Conservative on purpose: a stop fills at the tick price that crossed it (can be worse than the stop), a target fills at the target price.
 * Analysis only: nothing here places or manages a real trade.
 */
export const TRACK = { fillCandles: 20, holdCandles: 100 } as const; // keep equal to SIGNAL_RULES in @dmi/strategies (tested)

export type Tracked = { id: string; direction: 'long' | 'short'; entry: number; stop: number; target: number; entryStatus: 'pending' | 'filled'; createdMs: number; filledMs?: number; tfSec: number };
export type TrackPatch = { entryStatus: 'filled' | 'done'; result?: 'win' | 'loss' | 'expired' | 'missed'; filledAt?: string; closedAt?: string; exitPrice?: number; rMultiple?: number; event: 'filled' | 'win' | 'loss' | 'expired' | 'missed'; why?: string };

/** One price update. Returns what changed, or null when nothing happened. `epoch` is the tick time in seconds. */
export function trackStep(e: Tracked, price: number, epoch: number, cfg: { fillCandles: number; holdCandles: number } = TRACK): TrackPatch | null {
  const long = e.direction === 'long', risk = Math.abs(e.entry - e.stop), nowMs = epoch * 1000, iso = new Date(nowMs).toISOString();
  if (!(risk > 0) || !Number.isFinite(price)) return null;
  const rOf = (exit: number) => (long ? exit - e.entry : e.entry - exit) / risk;
  let filledMs = e.filledMs;
  if (e.entryStatus === 'pending') {
    if (long ? price >= e.target : price <= e.target) return { entryStatus: 'done', result: 'missed', closedAt: iso, event: 'missed', why: 'Price reached the target without pulling back to the entry, so the order never filled.' };
    if (nowMs - e.createdMs > cfg.fillCandles * e.tfSec * 1000) return { entryStatus: 'done', result: 'missed', closedAt: iso, event: 'missed', why: `The entry was not reached within ${cfg.fillCandles} candles.` };
    if (!(long ? price <= e.entry : price >= e.entry)) return null;
    // Filled. If the same tick is already beyond the stop, the trade is stopped out immediately.
    if (long ? price <= e.stop : price >= e.stop) return { entryStatus: 'done', result: 'loss', filledAt: iso, closedAt: iso, exitPrice: price, rMultiple: rOf(price), event: 'loss', why: 'Filled and stopped out on the same price move.' };
    return { entryStatus: 'filled', filledAt: iso, event: 'filled' };
  }
  filledMs ??= e.createdMs;
  if (long ? price <= e.stop : price >= e.stop) return { entryStatus: 'done', result: 'loss', closedAt: iso, exitPrice: price, rMultiple: rOf(price), event: 'loss', why: 'Stop reached.' };
  if (long ? price >= e.target : price <= e.target) return { entryStatus: 'done', result: 'win', closedAt: iso, exitPrice: e.target, rMultiple: rOf(e.target), event: 'win', why: 'Target reached.' };
  if (nowMs - filledMs > cfg.holdCandles * e.tfSec * 1000) return { entryStatus: 'done', result: 'expired', closedAt: iso, exitPrice: price, rMultiple: rOf(price), event: 'expired', why: `Neither stop nor target was reached within ${cfg.holdCandles} candles, so it was closed at the market price.` };
  return null;
}

const ms = (x: any) => (typeof x === 'number' ? x : Date.parse(x));
/** Build the tracker input from a stored journal row (Supabase ISO strings or file-store numbers). Returns null if the row can't be tracked. */
export function toTracked(row: any, tfSecOf: (tf: string) => number | undefined): Tracked | null {
  const tfSec = tfSecOf(row.tf), entry = Number(row.entry), stop = Number(row.stop), target = Number(row.target), createdMs = ms(row.createdAt);
  if (!tfSec || ![entry, stop, target, createdMs].every(Number.isFinite) || !['pending', 'filled'].includes(row.entryStatus) || !['long', 'short'].includes(row.direction) || row.result !== 'open') return null;
  return { id: row.id, direction: row.direction, entry, stop, target, entryStatus: row.entryStatus, createdMs, filledMs: row.filledAt ? ms(row.filledAt) : undefined, tfSec };
}
