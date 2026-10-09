import crypto from 'node:crypto';
import type { Candle } from '@dmi/types';
import { scenario, type analyze, type closedCandle } from '@dmi/strategies';
import { fvgs, zones } from '@dmi/supply-demand';
import { atr } from '@dmi/indicators';
import { swings } from '@dmi/market-structure';
import { SB, SVC, supabaseEnabled } from './auth.js';
import { child } from './log.js';
/**
 * Persists the engine's output (indicators, structure, bias, confluence, swings, liquidity, zones, FVGs, potential setups and their outcomes, snapshots)
 * for streamed (symbol, timeframe) pairs on every candle close. Batched, best-effort, deduplicated; live analysis never depends on it.
 * Timeframes below ANALYSIS_PERSIST_MIN_TF_SECONDS (default 300 = 5m) are skipped to protect free-tier storage.
 */
const log = child('analysis-store'), iso = (t: number) => new Date(t * 1000).toISOString(), MIN_TF = Number(process.env.ANALYSIS_PERSIST_MIN_TF_SECONDS) || 300, MAX_ROWS = 20_000;
type Q = { keys: string[] | null; ignore: boolean; rows: Map<string, any> };
const queues = new Map<string, Q>(); let seq = 0;
function q(table: string, row: any, keys: string[] | null = null, ignore = false) {
  let t = queues.get(table); if (!t) queues.set(table, t = { keys, ignore, rows: new Map() });
  t.rows.set(keys ? keys.map(k => row[k]).join('|') : String(seq++), row);
  while (t.rows.size > MAX_ROWS) t.rows.delete(t.rows.keys().next().value!);
}
export async function flush() {
  let failed = false;
  for (const [table, t] of queues) {
    if (table === 'setup_events' && failed) continue; // events reference setups: never insert them ahead of a failed setups write
    while (t.rows.size) {
      const entries = [...t.rows.entries()].slice(0, 500), path = t.keys ? `${table}?on_conflict=${t.keys.join(',')}` : table;
      const r = await fetch(`${SB}/rest/v1/${path}`, { method: 'POST', body: JSON.stringify(entries.map(e => e[1])),
        headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: `${t.keys ? `resolution=${t.ignore ? 'ignore' : 'merge'}-duplicates,` : ''}return=minimal` } }).catch(() => null);
      if (r && !r.ok && r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408) { log.error({ table, status: r.status }, 'analysis batch rejected, dropped'); for (const [k] of entries) t.rows.delete(k); continue; }
      if (!r?.ok) { failed = true; log.warn({ table, status: r?.status }, 'analysis flush failed, will retry'); break; }
      for (const [k] of entries) t.rows.delete(k);
    }
  }
}
if (supabaseEnabled) setInterval(() => flush().catch(() => {}), 10_000);

type Setup = { row: any; dir: string; lo: number; hi: number; inval: number; t1?: number; t2?: number; entered: boolean; t1hit: boolean; ts: number };
const open = new Map<string, Setup[]>(), lastSig = new Map<string, string>(), pending = new Map<string, { ts: number; level: number; dir: string }[]>();
const ev = (st: Setup, c: Candle, event: string) => q('setup_events', { setup_id: st.row.id, ts: iso(c.time), event, price: c.close });
const save = (st: Setup, status: string) => { st.row = { ...st.row, status, updated_at: new Date().toISOString() }; q('potential_setups', st.row, ['id']); }; // full row: upserts need every NOT NULL column

export function record(sym: string, tf: string, tfSec: number, done: Candle[], an: ReturnType<typeof analyze>, cc: ReturnType<typeof closedCandle>) {
  if (!supabaseEnabled || tfSec < MIN_TF) return;
  const last = done[done.length - 1], ts = iso(last.time), key = `${sym}|${tf}`, base = { symbol: sym, timeframe: tf }, K = ['symbol', 'timeframe', 'ts'], DK = [...K, 'direction'], { snapshot: s, detail: d } = an, i = d.indicators;
  q('indicator_values', { ...base, ts, ema20: i.ema20, ema50: i.ema50, ema100: i.ema100, ema200: i.ema200, sma50: i.sma50, rsi: i.rsi, macd_hist: i.macdHist, atr: i.atr, avg_range: i.avgRange, roc10: i.roc10, volatility_ratio: i.volatilityRatio }, K);
  q('market_structures', { ...base, ts, structure: s.structure, htf_structure: s.htfStructure, range_state: s.rangeState, volatility: s.volatility, labels: d.labels, last_break: d.break }, K);
  q('market_biases', { ...base, ts, bias: s.bias, momentum: s.momentum, ema_alignment: s.emaAlignment }, K);
  q('confluence_scores', { ...base, ts, score: s.confluenceScore, parts: d.scoreParts }, K);
  q('analysis_snapshots', { ...base, ts, snapshot: s }, K);
  for (const x of swings(done).slice(-10)) q('swing_points', { ...base, ts: iso(done[x.i].time), type: x.type, price: x.price, confirmed_at: iso(done[Math.min(x.i + 3, done.length - 1)].time) }, [...K, 'type'], true);
  const pools = new Map<string, any>(); for (const e of d.equalLevels) pools.set(`${e.type}|${e.price}`, e);
  for (const e of [...pools.values()].slice(-20)) q('liquidity_zones', { ...base, type: e.type === 'high' ? 'equal_highs' : 'equal_lows', price: +e.price.toFixed(8), first_seen: ts }, ['symbol', 'timeframe', 'type', 'price'], true);
  const pend = pending.get(key) ?? []; pending.set(key, pend);
  for (const e of cc.events) if (e.kind.startsWith('SWEEP')) { q('liquidity_events', { ...base, ts, direction: e.dir, level: e.price, confirmation: 'closed_back_inside' }, DK); pend.push({ ts: last.time, level: e.price, dir: e.dir }); }
  for (const p of [...pend]) if ((last.time - p.ts) / tfSec >= 5) { // subsequent reaction: move over the 5 candles after the sweep, positive = in the sweep's implied direction
    pend.splice(pend.indexOf(p), 1); const r = ((p.dir === 'bullish' ? last.close - p.level : p.level - last.close) / p.level) * 100;
    q('liquidity_events', { ...base, ts: iso(p.ts), direction: p.dir, level: p.level, confirmation: 'closed_back_inside', reaction_5_pct: +r.toFixed(4) }, DK);
  }
  for (const g of fvgs(done).slice(-10)) q('fair_value_gaps', { ...base, ts: iso(done[g.i].time), direction: g.dir, upper: g.upper, lower: g.lower, fill_pct: g.fillPct ?? 0, filled: g.filled }, DK);
  for (const z of zones(done, atr(done)).slice(-10)) q('supply_demand_zones', { ...base, ts: iso(done[Math.min(z.i + 1, done.length - 1)].time), direction: z.dir, upper: z.upper, lower: z.lower, strength: z.strength, tests: z.tests, status: z.status }, DK);
  for (const z of d.priceActionZones) q('price_action_zones', { ...base, ts: iso(z.createdAt), direction: z.dir, upper: z.upper, lower: z.lower, base_ts: iso(z.time), retests: z.retests, status: z.status }, DK);

  // Potential setups: record the scenario when it appears, then track its outcome candle by candle.
  const list = open.get(key) ?? []; open.set(key, list);
  for (const st of [...list]) {
    const bull = st.dir === 'bullish', drop = () => list.splice(list.indexOf(st), 1);
    if (!st.entered && last.low <= st.hi && last.high >= st.lo) { st.entered = true; ev(st, last, 'entered_zone'); }
    if (!st.t1hit && (bull ? last.close < st.inval : last.close > st.inval)) { ev(st, last, 'invalidated'); save(st, 'invalidated'); drop(); }
    else if (st.entered && st.t2 !== undefined && (bull ? last.high >= st.t2 : last.low <= st.t2)) { ev(st, last, 'target2_hit'); save(st, 'target2_hit'); drop(); }
    else if (st.entered && !st.t1hit && st.t1 !== undefined && (bull ? last.high >= st.t1 : last.low <= st.t1)) { st.t1hit = true; ev(st, last, 'target1_hit'); save(st, 'target1_hit'); if (st.t2 === undefined) drop(); }
    else if ((last.time - st.ts) / tfSec > 100) { ev(st, last, 'expired'); if (!st.t1hit) save(st, 'expired'); drop(); }
  }
  const sc = scenario(s, { zones: d.zones, fvgs: d.fvgs }, last.close, d.indicators.atr);
  if (sc?.entryZone && list.length < 5) {
    const z = sc.entryZone, sig = `${sc.direction}|${z.kind}|${z.lower.toFixed(6)}|${z.upper.toFixed(6)}`;
    if (lastSig.get(key) !== sig) {
      lastSig.set(key, sig);
      const row = { id: crypto.randomUUID(), ...base, created_ts: ts, direction: sc.direction, entry_kind: z.kind, entry_lower: z.lower, entry_upper: z.upper, invalidation: sc.invalidation, target1: sc.targets[0] ?? null, target2: sc.targets[1] ?? null,
        estimated_rr: sc.estimatedRR, status: 'open', updated_at: new Date().toISOString(), reasons: { bias: s.bias, structure: s.structure, htf: s.htfStructure, momentum: s.momentum, sweep: s.liquiditySweep, fvg: s.fvg, confluence: s.confluenceScore } };
      const st: Setup = { row, dir: sc.direction, lo: z.lower, hi: z.upper, inval: sc.invalidation, t1: sc.targets[0], t2: sc.targets[1], entered: false, t1hit: false, ts: last.time };
      list.push(st); q('potential_setups', row, ['id']); ev(st, last, 'created');
    }
  }
}
/** Recent potential setups (with outcome status) for a market/timeframe. */
export async function readSetups(symbol: string, tf: string) {
  if (!supabaseEnabled) return [];
  const r = await fetch(`${SB}/rest/v1/potential_setups?symbol=eq.${encodeURIComponent(symbol)}&timeframe=eq.${tf}&order=created_ts.desc&limit=20&select=id,created_ts,direction,entry_kind,entry_lower,entry_upper,invalidation,target1,target2,estimated_rr,status,reasons`,
    { headers: { apikey: SVC!, Authorization: `Bearer ${SVC}` } }).catch(() => null);
  return r?.ok ? ((await r.json()) as any[]) : [];
}
