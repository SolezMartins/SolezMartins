/**
 * Performance report built from the user's own journal. Pure (no I/O) so it can be unit-tested.
 * R per trade: measured (auto-tracked signals store their real R) or planned (manual entries: win = planned target R, loss = -1, breakeven = 0).
 * Planned R is an approximation: manual wins are assumed to exit at the target.
 */
import { summarizeR, evidenceVerdict } from '@dmi/strategies';

const num = (x: any) => (x === null || x === undefined || x === '' ? NaN : Number(x));
const ms = (x: any) => (typeof x === 'number' ? x : Date.parse(x));

export type Rated = { row: any; r: number; basis: 'measured' | 'planned'; at: number };
/** R-multiple of a closed entry, or null when it has no usable R (open, missed, or missing stop/target). */
export function rated(e: any): Rated | null {
  const res = e.result, at = ms(e.closedAt ?? e.createdAt);
  if (!res || res === 'open' || res === 'missed') return null;
  const m = num(e.rMultiple); if (Number.isFinite(m)) return { row: e, r: m, basis: 'measured', at };
  if (res === 'loss') return { row: e, r: -1, basis: 'planned', at };
  if (res === 'breakeven') return { row: e, r: 0, basis: 'planned', at };
  if (res === 'win') { const r = Math.abs(num(e.target) - num(e.entry)) / Math.abs(num(e.entry) - num(e.stop)); return Number.isFinite(r) ? { row: e, r, basis: 'planned', at } : null; }
  return null; // expired without a measured R
}
const band = (s: any) => { const n = num(s); return !Number.isFinite(n) ? 'n/a' : n >= 80 ? '80+' : n >= 70 ? '70-79' : n >= 60 ? '60-69' : n >= 50 ? '50-59' : 'under 50'; };
const group = (xs: Rated[], key: (r: Rated) => string) => {
  const m = new Map<string, number[]>(); for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x.r]); }
  return [...m.entries()].map(([k, rs]) => ({ key: k, ...summarizeR(rs) })).sort((a, b) => b.n - a.n);
};

export function computePerformance(rows: any[]) {
  const xs = rows.map(rated).filter((x): x is Rated => x !== null).sort((a, b) => a.at - b.at), signals = rows.filter(r => r.source === 'signal');
  const overall = summarizeR(xs.map(x => x.r)), auto = xs.filter(x => x.row.source === 'signal'), manual = xs.filter(x => x.row.source !== 'signal');
  const autoSum = summarizeR(auto.map(x => x.r)), filledEver = signals.filter(r => r.filledAt || ['win', 'loss', 'expired'].includes(r.result)).length, missed = signals.filter(r => r.result === 'missed').length;
  let cum = 0; const equity = xs.map(x => ({ t: x.at, r: (cum += x.r) })).slice(-300);
  const notes = ['Built only from your own journal. Past results do not predict future ones.',
    'Auto-tracked signals use their measured R. Manual entries use planned R (wins at the target, losses at -1R), which is an approximation.',
    'Ranges are rough 95% ranges; with few trades they are very wide. Do not act on a group with fewer than about 30 trades.'];
  const risky = overall.n >= 30 ? [] : [`Only ${overall.n} closed trades so far: the numbers below are not reliable yet.`];
  return {
    counts: { entries: rows.length, closed: xs.length, open: rows.filter(r => r.result === 'open').length, pending: rows.filter(r => r.result === 'open' && r.entryStatus === 'pending').length,
      signals: signals.length, manual: rows.length - signals.length, filled: filledEver, missed, fillRate: filledEver + missed ? filledEver / (filledEver + missed) : null },
    overall, signalsOnly: autoSum, manualOnly: summarizeR(manual.map(x => x.r)), verdict: evidenceVerdict(overall, null), signalsVerdict: evidenceVerdict(autoSum, null),
    byMarket: group(xs, x => x.row.symbol ?? '?').slice(0, 20), byTimeframe: group(xs, x => x.row.tf ?? 'manual'), byConfluence: group(xs, x => band(x.row.confluence)),
    byDirection: group(xs, x => x.row.direction ?? '?'), bySource: group(xs, x => (x.row.source === 'signal' ? (String(x.row.strategy ?? '').includes('SMC') ? 'auto SMC signal' : 'auto confluence signal') : 'manual')),
    byScenario: group(auto, x => x.row.scenarioStatus ?? 'unknown'), // status of the scenario when the auto signal was created (in zone / waiting / do not chase)
    equity, notes: [...risky, ...notes],
  };
}
