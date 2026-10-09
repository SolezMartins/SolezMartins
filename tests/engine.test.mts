// Run: npm test   (Node 22.6+; uses built-in type stripping, no extra dependencies)
import test from 'node:test'; import assert from 'node:assert/strict';
import { analyze, historyEvents, runBacktest, scenario, scenarioBacktest, summarizeR, evidenceVerdict, SIGNAL_RULES, smcSetup, smcRead, SMC, entryStatusAt, isChasing } from '../packages/strategies/src/index.ts';
import { scnHit, SCN_KIND } from '../apps/api/src/scenarioAlerts.ts';
import { trackStep, toTracked, TRACK } from '../apps/api/src/tracker.ts';
import { computePerformance } from '../apps/api/src/performance.ts';
import { liveEntry, riskPlan, scenarioView, SCENARIO_OPTIONS } from '../apps/web/src/scenarioStatus.ts';
import { swings } from '../packages/market-structure/src/index.ts';
const mk = (f: (i: number) => number, n = 200) => Array.from({ length: n }, (_, i) => { const o = f(i), c = f(i + 1); return { time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, c) + 0.6, low: Math.min(o, c) - 0.6, close: c }; });
const zig = (slope: number) => (i: number) => 1000 + slope * i + 6 * Math.sin(i / 3);
const finite = (x: any): boolean => x && typeof x === 'object' ? Object.values(x).every(finite) : typeof x !== 'number' || Number.isFinite(x);

test('uptrend with pullbacks is bullish; downtrend is bearish', () => {
  assert.equal(analyze('T', '15m', mk(zig(0.8))).snapshot.structure, 'bullish');
  assert.equal(analyze('T', '15m', mk(zig(-0.8))).snapshot.structure, 'bearish');
});
test('a flat top or bottom yields a single swing (regression: duplicate swings flipped trends)', () => {
  const s = swings(mk(zig(0.8)));
  assert.ok(s.every((x, i) => !i || !(x.type === s[i - 1].type && x.price === s[i - 1].price)));
});
test('demand zone is detected after a bearish base + bullish impulse', () => {
  const q = mk(() => 1000, 60);
  q.push({ time: q[59].time + 900, open: 1000.4, high: 1000.8, low: 999.6, close: 999.7 }, { time: q[59].time + 1800, open: 999.7, high: 1010, low: 999.6, close: 1009.5 });
  for (let i = 0; i < 10; i++) q.push({ time: q[q.length - 1].time + 900, open: 1009.5, high: 1010.2, low: 1009, close: 1009.6 });
  assert.equal(analyze('T', '15m', q).detail.zones[0]?.dir, 'demand');
});
test('history events are lookahead-free and analysis/backtest output is finite', () => {
  const c = mk(zig(0.3), 900), keep = (e: any) => /^(BOS|CHOCH|SWEEP)/.test(e.kind);
  assert.deepEqual(historyEvents(c.slice(0, 600)).events.filter(keep), historyEvents(c).events.filter(e => keep(e) && e.time <= c[599].time));
  assert.ok(finite(analyze('T', '15m', c)));
  const r = runBacktest(c, { direction: 'long', require: ['sweep', 'bos'], window: 20, stopAtr: 1.5, rr: 2, maxHold: 50, htfFactor: 4 }, 900);
  assert.ok(finite(r)); assert.equal(r.all.setups, r.inSample.setups + r.outOfSample.setups);
});

import { closedCandle } from '../packages/strategies/src/index.ts';
test('closedCandle reports only events stamped on the just-closed candle (alerts fire on new events, not standing conditions)', () => {
  let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let p = 1000; const c = Array.from({ length: 400 }, (_, i) => { const o = p, cl = o + (rnd() - 0.5) * 4 + (i < 200 ? 0.2 : -0.2); p = cl; return { time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, cl) + rnd() * 1.5, low: Math.min(o, cl) - rnd() * 1.5, close: cl }; });
  const all = historyEvents(c).events;
  for (let k = 100; k <= 400; k += 13) assert.deepEqual(closedCandle(c.slice(0, k)).events.filter(e => !e.kind.startsWith('EMA')), all.filter(e => e.time === c[k - 1].time));
});
test('EMA20/50 cross is reported on the candle where it happens, once', () => {
  const c = Array.from({ length: 300 }, (_, i) => { const f = (j: number) => 1000 + (j < 150 ? -j : j - 300) * 0.8; return { time: 1_700_000_000 + i * 900, open: f(i), high: f(i + 1) + 0.5, low: f(i) - 0.5, close: f(i + 1) }; });
  const hits = [] as number[]; for (let k = 61; k <= 300; k++) if (closedCandle(c.slice(0, k)).events.some(e => e.kind === 'EMA_CROSS_BULLISH')) hits.push(k);
  assert.equal(hits.length, 1);
});

import { candlePatterns, volatilityState, roc } from '../packages/indicators/src/index.ts';
import { keyLevels, rangeState } from '../packages/market-structure/src/index.ts';
import { htfStructure } from '../packages/strategies/src/index.ts';
const bar = (o: number, h: number, l: number, c: number, i = 0) => ({ time: 1_700_000_000 + i * 900, open: o, high: h, low: l, close: c });
test('candle patterns', () => {
  assert.ok(candlePatterns([bar(10, 10.2, 8.9, 9, 0), bar(8.8, 10.5, 8.7, 10.4, 1)]).some(p => p.name === 'Bullish engulfing'));
  assert.ok(candlePatterns([bar(10, 10.1, 9.9, 10, 0), bar(10, 10.5, 9.5, 10.01, 1)]).some(p => p.name === 'Doji'));
  assert.ok(candlePatterns([bar(10, 10.1, 9.9, 10, 0), bar(9.8, 10.7, 8, 10.6, 1)]).some(p => p.name === 'Hammer'));
});
test('volatility regime, ROC, range state', () => {
  const quiet = Array.from({ length: 80 }, (_, i) => bar(100, 100.5, 99.5, 100, i)), wild = [...quiet, ...Array.from({ length: 15 }, (_, i) => bar(100, 106, 94, 100, 80 + i))];
  assert.equal(volatilityState(wild).state, 'expanding'); assert.equal(volatilityState(quiet).state, 'normal');
  assert.ok(Math.abs(roc([100, 110], 1)[1] - 10) < 1e-9);
  assert.equal(rangeState(quiet, 1).state, 'range'); assert.notEqual(rangeState(mk(zig(2)), 1.2).state, 'range');
});
test('repeated reaction zones become major levels', () => {
  const sw = [1000, 1000.2, 999.9, 1020, 1000.1].map((price, i) => ({ i, type: 'high' as const, price }));
  const lv = keyLevels(sw, 1010, 1); assert.equal(lv.support[0].touches, 4); assert.equal(lv.resistance.length, 0);
});
test('HTF structure and the 11-component confluence score', () => {
  const up = mk(i => 1000 + 1.5 * i + 25 * Math.sin(i / 12), 600), a = analyze('T', '15m', up); // trend with pullbacks slow enough to survive x4 resampling
  assert.equal(htfStructure(up), 'bullish'); assert.equal(a.snapshot.htfStructure, 'bullish');
  const parts = Object.values(a.detail.scoreParts) as number[]; assert.equal(Object.keys(a.detail.scoreParts).length, 11);
  assert.equal(parts.reduce((x, y) => x + y, 0), a.snapshot.confluenceScore); assert.ok(a.snapshot.confluenceScore <= 100);
  const flat = analyze('T', '15m', mk(() => 1000, 200)); assert.equal(flat.snapshot.confluenceScore, 0); assert.ok(Object.values(flat.detail.scoreParts).every(v => v === 0));
  assert.ok(finite(a));
});

test('swing sensitivity option changes the swings used and never breaks the analysis', () => {
  const c = mk(i => 1000 + 1.5 * i + 25 * Math.sin(i / 12) + 4 * Math.sin(i / 2), 600);
  const a = analyze('T', '15m', c), tight = analyze('T', '15m', c, { left: 2, right: 2 }), wide = analyze('T', '15m', c, { left: 6, right: 6 });
  assert.ok(finite(tight) && finite(wide)); assert.ok(swings(c, 2, 2).length > swings(c, 6, 6).length);
  assert.equal(JSON.stringify(a), JSON.stringify(analyze('T', '15m', c, {}))); // default stays 3/3
});

import { priceActionZones } from '../packages/strategies/src/index.ts';
test('price-action zone: last opposite candle before a bullish BOS, with retest/invalidation tracking', () => {
  const c = [...Array.from({ length: 20 }, (_, i) => bar(1000, 1000.5, 999.5, 1000, i)), bar(1000, 1010, 999.8, 1009, 20), bar(1009, 1009.5, 1006, 1006.5, 21), bar(1006.5, 1007, 1004, 1004.5, 22), bar(1004.5, 1005.5, 1003, 1003.5, 23),
    bar(1003.5, 1004, 1002.5, 1003, 24), bar(1003, 1012, 1002.9, 1011.5, 25), bar(1011.5, 1013, 1011, 1012.5, 26)];
  const z = priceActionZones(c, historyEvents(c).events);
  assert.equal(z.length, 1); assert.equal(z[0].dir, 'bullish'); assert.equal(z[0].lower, 1002.5); assert.equal(z[0].upper, 1004); assert.equal(z[0].status, 'fresh');
  const broken = [...c, bar(1012.5, 1012.6, 1001, 1001.5, 27)]; assert.equal(priceActionZones(broken, historyEvents(broken).events)[0].status, 'invalidated');
});

// ---- scenario(): ATR stop floor and entry status ----
const snapBull = { bias: 'bullish', support: [], resistance: [4960, 4970], majorSupport: [], majorResistance: [] } as any;
const demand = { zones: [{ dir: 'demand', lower: 4899, upper: 4904 }], fvgs: [] } as any;
test('scenario: stop is at least 0.75 ATR beyond the zone, so a tight stop cannot produce a huge fake R:R', () => {
  const tight = scenario(snapBull, demand, 4906, 0)!, wide = scenario(snapBull, demand, 4906, 20)!;
  assert.ok(wide.invalidation <= 4899 - 15 + 1e-9, `stop ${wide.invalidation} should be >= 15 below the zone`);
  assert.ok(wide.risk > tight.risk && wide.estimatedRR! < tight.estimatedRR!);
  assert.ok(tight.warnings.some((w: string) => w.includes('ATR')), 'without ATR the scenario should say the stop is zone-only');
});
test('scenario: status says whether the entry is still valid at the current price', () => {
  const at = (p: number) => scenario(snapBull, demand, p, 20)!.status;
  assert.equal(at(4945), 'waiting');       // price far above the zone: entering here is chasing, not this plan
  assert.equal(at(4902), 'in_zone');
  assert.equal(at(4890), 'through_zone');  // below the zone but above the stop
  assert.equal(scenario(snapBull, demand, 4880, 20)!.entryZone, null); // beyond the stop (4899 - 15 = 4884): the scenario no longer exists
  assert.equal(at(4965), 'target_passed'); // beyond target 1 (4960)
  const d = scenario(snapBull, demand, 4945, 20)!; assert.ok(Math.abs(d.distance - 41) < 1e-9);
});
test('scenario: bearish mirrors bullish', () => {
  const bear = { bias: 'bearish', support: [4850, 4840], resistance: [], majorSupport: [], majorResistance: [] } as any, supply = { zones: [{ dir: 'supply', lower: 4899, upper: 4904 }], fvgs: [] } as any;
  const s = scenario(bear, supply, 4860, 20)!; assert.equal(s.status, 'waiting'); assert.ok(s.invalidation >= 4904 + 15 - 1e-9); assert.equal(scenario(bear, supply, 4920, 20)!.entryZone, null);
});

// ---- web helpers: live entry status and risk sizing (numbers from the 4945.22 entry on Volatility 75) ----
test('liveEntry: entering far above the zone is flagged as chasing with the real risk and R:R', () => {
  const sc = scenario(snapBull, demand, 4906, 20)!, le = liveEntry(sc as any, 4945.22, 2)!;
  assert.equal(le.status, 'waiting'); assert.equal(le.chasing, true); assert.ok(le.distance > 40);
  assert.ok(le.riskNow > 40, 'stop is far from a 4945 entry'); assert.ok(le.rrNow! < 0.5, `R:R from 4945 should be poor, got ${le.rrNow}`);
  assert.match(le.text, /chasing/i);
});
test('liveEntry: statuses follow the live price', () => {
  const sc = scenario(snapBull, demand, 4906, 20)! as any, st = (p: number) => liveEntry(sc, p)!.status;
  assert.equal(st(4902), 'in_zone'); assert.equal(st(4890), 'through_zone'); assert.equal(st(4880), 'invalidated'); assert.equal(st(4965), 'target_passed');
  assert.equal(liveEntry({ ...sc, entryZone: null }, 4900), null); assert.equal(liveEntry(sc, null), null);
});
test('scenarioView: scanner status matches the market page and covers every state', () => {
  const sc = scenario(snapBull, demand, 4906, 20)! as any, key = (p: number) => scenarioView(sc, p).key;
  assert.equal(key(4945.22), 'do_not_chase'); assert.equal(scenarioView(sc, 4945.22).label, liveEntry(sc, 4945.22)!.label);
  assert.equal(key(4910), 'waiting'); assert.equal(key(4902), 'in_zone'); assert.equal(key(4890), 'through_zone'); assert.equal(key(4880), 'invalidated'); assert.equal(key(4965), 'target_passed');
  assert.equal(scenarioView({ ...sc, entryZone: null }, 4900).key, 'no_zone'); assert.equal(scenarioView(null, 4900).key, 'none');
  for (const k of ['in_zone', 'waiting', 'do_not_chase', 'through_zone', 'target_passed', 'invalidated', 'no_zone', 'none']) assert.ok(SCENARIO_OPTIONS.some(o => o.key === k), k);
});
test('riskPlan: max loss, multiplier stake, and stop-out before the stop', () => {
  const p = riskPlan({ balance: 1000, riskPct: 1, entry: 4900, stop: 4850, target: 4990, multiplier: 20 })!; // stop is 1.02% away, x20 = 20.4% of stake
  assert.equal(p.maxLoss, 10); assert.ok(Math.abs(p.stake! * 20 * (50 / 4900) - 10) < 1e-9); assert.ok(Math.abs(p.lossAtStop! - 10) < 1e-9);
  assert.ok(Math.abs(p.rMultiple! - 90 / 50) < 1e-9); assert.equal(p.stopOutBeforeStop, false);
  const q = riskPlan({ balance: 1000, riskPct: 1, entry: 4900, stop: 4600, multiplier: 100 })!; // 6.1% x100 = 612% -> stop-out comes first
  assert.equal(q.stopOutBeforeStop, true); assert.equal(q.stake, 10); assert.ok(q.warnings.some((w: string) => /stops out/.test(w)));
  const f = riskPlan({ balance: 1000, riskPct: 3, entry: 4900, stop: 4850 })!; assert.equal(f.stake, null); assert.ok(f.warnings.some((w: string) => /guideline/.test(w)));
  assert.equal(riskPlan({ balance: 0, riskPct: 1, entry: 1, stop: 0.5 }), null); assert.equal(riskPlan({ balance: 100, riskPct: 1, entry: 5, stop: 5 }), null);
});

// ---- outcome tracker (pure) ----
const T0 = 1_700_000_000, long = { id: 'a', direction: 'long', entry: 4900, stop: 4880, target: 4960, entryStatus: 'pending', createdMs: T0 * 1000, tfSec: 900 } as any;
test('tracker constants match the signal rules used by the live alert and the backtest', () => { assert.equal(TRACK.fillCandles, SIGNAL_RULES.fillCandles); assert.equal(TRACK.holdCandles, SIGNAL_RULES.holdCandles); });
test('tracker: a long limit order fills on a pullback, then hits the target for +R', () => {
  assert.equal(trackStep(long, 4920, T0 + 60), null); // still above the entry
  const f = trackStep(long, 4899.5, T0 + 120)!; assert.equal(f.event, 'filled'); assert.equal(f.entryStatus, 'filled');
  const w = trackStep({ ...long, entryStatus: 'filled', filledMs: (T0 + 120) * 1000 }, 4961, T0 + 900)!; assert.equal(w.result, 'win'); assert.equal(w.exitPrice, 4960); assert.ok(Math.abs(w.rMultiple! - 3) < 1e-9);
});
test('tracker: stop gives a loss; a gap through the stop is recorded at the worse tick price', () => {
  const filled = { ...long, entryStatus: 'filled', filledMs: T0 * 1000 };
  const l = trackStep(filled, 4880, T0 + 100)!; assert.equal(l.result, 'loss'); assert.ok(Math.abs(l.rMultiple! + 1) < 1e-9);
  const g = trackStep(filled, 4860, T0 + 100)!; assert.ok(g.rMultiple! < -1.9, `gap should be worse than -1R, got ${g.rMultiple}`);
  const both = trackStep(long, 4870, T0 + 100)!; assert.equal(both.result, 'loss'); assert.ok(both.filledAt); // filled and stopped on the same move
});
test('tracker: missed when the target runs without a fill, or no fill within the time limit; expired after the hold limit', () => {
  assert.equal(trackStep(long, 4965, T0 + 60)!.result, 'missed');
  assert.equal(trackStep(long, 4930, T0 + (TRACK.fillCandles + 1) * 900)!.result, 'missed');
  const ex = trackStep({ ...long, entryStatus: 'filled', filledMs: T0 * 1000 }, 4910, T0 + (TRACK.holdCandles + 1) * 900)!; assert.equal(ex.result, 'expired'); assert.ok(Math.abs(ex.rMultiple! - 0.5) < 1e-9);
});
test('tracker: short mirrors long', () => {
  const sh = { id: 'b', direction: 'short', entry: 4900, stop: 4920, target: 4840, entryStatus: 'pending', createdMs: T0 * 1000, tfSec: 900 } as any;
  assert.equal(trackStep(sh, 4880, T0 + 60), null); assert.equal(trackStep(sh, 4901, T0 + 60)!.event, 'filled');
  assert.equal(trackStep({ ...sh, entryStatus: 'filled', filledMs: T0 * 1000 }, 4839, T0 + 100)!.result, 'win'); assert.equal(trackStep({ ...sh, entryStatus: 'filled', filledMs: T0 * 1000 }, 4921, T0 + 100)!.result, 'loss');
});
test('toTracked: parses Supabase rows (ISO dates) and rejects untrackable ones', () => {
  const row = { id: 'x', direction: 'long', entry: '4900', stop: 4880, target: 4960, entryStatus: 'pending', result: 'open', tf: '15m', createdAt: new Date(T0 * 1000).toISOString() };
  const t = toTracked(row, tf => ({ '15m': 900 } as any)[tf])!; assert.equal(t.createdMs, T0 * 1000); assert.equal(t.entry, 4900);
  assert.equal(toTracked({ ...row, result: 'win' }, () => 900), null); assert.equal(toTracked({ ...row, entryStatus: undefined }, () => 900), null); assert.equal(toTracked(row, () => undefined), null);
});

// ---- statistics and verdict ----
test('summarizeR and evidenceVerdict', () => {
  const s = summarizeR([2, -1, -1, 2, -1]); assert.equal(s.n, 5); assert.equal(s.wins, 2); assert.ok(Math.abs(s.avgR! - 0.2) < 1e-9); assert.ok(Math.abs(s.profitFactor! - 4 / 3) < 1e-9);
  assert.ok(s.ciLow! < 0 && s.ciHigh! > 0); assert.ok(s.winRateLow! < 0.4 && s.winRateHigh! > 0.4); assert.equal(s.maxLossStreak, 2); assert.ok(Math.abs(s.maxDrawdownR - 2) < 1e-9);
  assert.equal(evidenceVerdict(s).level, 'insufficient');
  const noise = summarizeR(Array.from({ length: 60 }, (_, i) => (i % 2 ? -1 : 1))); assert.equal(evidenceVerdict(noise, noise).level, 'no_edge');
  const bad = summarizeR(Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? 1 : -1))); assert.equal(evidenceVerdict(bad, bad).level, 'negative');
  const good = summarizeR(Array.from({ length: 60 }, (_, i) => (i % 3 ? 1 : -1))); assert.equal(evidenceVerdict(good, good).level, 'positive');
  assert.equal(summarizeR([]).avgR, null);
});

// ---- performance report ----
test('computePerformance: measured R for auto signals, planned R for manual entries, open/missed excluded, bands and fill rate', () => {
  const rows = [
    { id: '1', symbol: 'R_75', direction: 'long', entry: 100, stop: 90, target: 130, result: 'win', source: 'signal', tf: '15m', confluence: 72, rMultiple: 2.5, entryStatus: 'done', filledAt: 'x', closedAt: 1000, createdAt: 900 },
    { id: '2', symbol: 'R_75', direction: 'long', entry: 100, stop: 90, target: 130, result: 'loss', source: 'signal', tf: '15m', confluence: 85, rMultiple: -1.3, entryStatus: 'done', filledAt: 'x', closedAt: 2000, createdAt: 1500 },
    { id: '3', symbol: 'R_50', direction: 'short', entry: 100, stop: 110, target: 80, result: 'win', createdAt: 3000 }, // manual: planned 2R
    { id: '4', symbol: 'R_50', direction: 'short', entry: 100, stop: 110, target: 80, result: 'loss', createdAt: 4000 }, // manual: -1R
    { id: '5', symbol: 'R_75', direction: 'long', entry: 1, stop: 0.5, target: 2, result: 'missed', source: 'signal', tf: '5m', entryStatus: 'done', createdAt: 5000 },
    { id: '6', symbol: 'R_75', direction: 'long', entry: 1, stop: 0.5, target: 2, result: 'open', source: 'signal', tf: '5m', entryStatus: 'pending', createdAt: 6000 },
  ];
  const p = computePerformance(rows);
  assert.equal(p.overall.n, 4); assert.ok(Math.abs(p.overall.totalR - (2.5 - 1.3 + 2 - 1)) < 1e-9);
  assert.equal(p.signalsOnly.n, 2); assert.equal(p.manualOnly.n, 2); assert.equal(p.counts.missed, 1); assert.equal(p.counts.pending, 1); assert.equal(p.counts.filled, 2); assert.ok(Math.abs(p.counts.fillRate! - 2 / 3) < 1e-9);
  assert.deepEqual(p.byConfluence.map(g => g.key).sort(), ['70-79', '80+', 'n/a']); assert.equal(p.byMarket.find(g => g.key === 'R_75')!.n, 2);
  assert.ok(p.notes.some(n => /Only 4 closed trades/.test(n))); assert.equal(p.verdict.level, 'insufficient'); assert.deepEqual(computePerformance([]).overall.n, 0);
});

// ---- scenario evidence backtest ----
function walk(n: number, seed: number) { // random walk with drifting regimes so zones, trends and pullbacks appear
  let s = seed, p = 4900, t = 1_700_000_000, drift = 0; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296, c: any[] = [];
  for (let i = 0; i < n; i++) { if (i % 150 === 0) drift = (rnd() - 0.5) * 6; const o = p, ch = drift + (rnd() - 0.5) * 30; p = o + ch; c.push({ time: (t += 900), open: o, high: Math.max(o, p) + rnd() * 8, low: Math.min(o, p) - rnd() * 8, close: p }); }
  return c;
}
test('scenarioBacktest: finite, accounted for, and conservative on stop/target ordering', async () => {
  const c = walk(1200, 7), r = await scenarioBacktest(c, { tfSec: 900, minScore: 40 });
  assert.ok(r.orders.placed > 0, 'test data should produce orders'); assert.equal(r.orders.placed, r.orders.filled + r.orders.missed + r.orders.unresolved);
  for (const t of r.trades) { assert.ok(Number.isFinite(t.r)); assert.ok(t.exitTime >= t.entryTime && t.entryTime > t.signalTime); if (t.reason === 'stop') assert.ok(Math.abs(t.r + 1) < 1e-9); if (t.reason === 'target') assert.ok(t.r > 0); }
  assert.equal(r.all.n, r.trades.length); assert.ok(['insufficient', 'negative', 'no_edge', 'positive'].includes(r.verdict.level)); assert.ok(r.notes.length >= 3);
});
test('scenarioBacktest: no lookahead (a run on a prefix reproduces the full run\'s trades that finished inside it)', async () => {
  const c = walk(1200, 11), cut = 900, a = await scenarioBacktest(c.slice(0, cut), { tfSec: 900, minScore: 40 }), b = await scenarioBacktest(c, { tfSec: 900, minScore: 40 });
  const inside = b.trades.filter(t => t.exitTime <= c[cut - 1].time), key = (t: any) => [t.signalTime, t.entry, t.stop, t.target, t.exit, t.reason].join('|');
  assert.ok(a.trades.length > 0, 'prefix should have trades'); assert.deepEqual(a.trades.map(key), inside.map(key));
});

// ---- SMC model: hand-built bullish setup (sweep of a swing low -> structure shift with displacement -> order block in discount) ----
function smcBars(extra: (add: (o: number, c: number, wu?: number, wd?: number) => void) => void = () => {}) {
  const T = 1_700_000_000, bars: any[] = [];
  const add = (o: number, c: number, wu = 0.4, wd = 0.4) => bars.push({ time: T + bars.length * 900, open: o, close: c, high: Math.max(o, c) + wu, low: Math.min(o, c) - wd });
  const path = (from: number, to: number, n: number) => { for (let i = 0; i < n; i++) add(from + (to - from) * i / n, from + (to - from) * (i + 1) / n); };
  path(116, 110, 12); path(110, 106, 8); path(106, 107.5, 3); path(107.5, 100, 8); path(100, 102, 3); path(102, 99.8, 4);
  add(99.6, 99.0, 0.2, 0.2);   // bearish candle = the order block (98.8 to 99.8)
  add(99.0, 100.5, 0.3, 1.2);  // sweep: wicks below the swing low (99.6), closes back above
  add(100.5, 104.2, 0.3, 0.2); // displacement: closes above the lower high (102.4)
  add(104.2, 106.5, 0.3, 0.1); add(106.5, 107.5, 0.3, 0.2);
  add(107.5, 107.0, 0.2, 0.3); path(107.0, 106.2, 3); // pullback that has not reached the order block (and never touches the 107.9 target)
  extra(add); return bars;
}
const flip = (c: any[], k = 220) => c.map(x => ({ time: x.time, open: k - x.open, high: k - x.low, low: k - x.high, close: k - x.close }));
test('smc: finds the sweep -> shift -> order block setup with sensible levels', () => {
  const s = smcSetup(smcBars(), 'bullish')!;
  assert.equal(s.direction, 'bullish'); assert.equal(s.entryZone.kind, 'order block'); assert.ok(Math.abs(s.entryZone.lower - 98.8) < 1e-9 && Math.abs(s.entryZone.upper - 99.8) < 1e-9);
  assert.ok(s.sweep.level > s.sweep.extreme, 'the sweep wick went below the level'); assert.equal(s.mss.displacement, 'fvg');
  assert.ok(s.invalidation < s.sweep.extreme, 'stop sits beyond the sweep extreme'); assert.ok(s.entryMid - s.invalidation >= SMC.minStopAtr * s.atr - 1e-9);
  assert.ok(s.entryMid <= s.range.eq, 'long entry is in discount'); assert.ok(s.targets[0] > s.entryMid && s.estimatedRR! > 1.5);
  assert.equal(s.status, 'waiting'); assert.equal(s.ok, true); assert.equal(s.htfAligned, true); assert.equal(smcSetup(smcBars(), 'bearish')!.htfAligned, false);
  assert.ok(s.checks.every(c => c.ok === true));
});
test('smc: the bearish mirror is detected the same way', () => {
  const s = smcSetup(flip(smcBars()), 'bearish')!;
  assert.equal(s.direction, 'bearish'); assert.equal(s.status, 'waiting'); assert.equal(s.ok, true); assert.ok(s.entryMid >= s.range.eq, 'short entry is in premium'); assert.ok(s.invalidation > s.entryMid && s.targets[0] < s.entryMid);
  assert.equal(s.entryZone.kind, 'order block'); assert.ok(Math.abs(s.entryZone.lower - (220 - 99.8)) < 1e-9);
});
test('smc: status follows what price does afterwards (and a used zone is not a fresh signal)', () => {
  const st = (extra: any) => smcSetup(smcBars(extra), 'bullish')!.status;
  assert.equal(st((add: any) => add(106.2, 100.2, 0.2, 0.6)), 'in_zone');         // reached the top of the zone, not the midpoint (99.3)
  assert.equal(st((add: any) => add(106.2, 99.5, 0.2, 0.4)), 'entry_passed');     // reached the entry
  assert.equal(st((add: any) => { add(106.2, 99.5, 0.2, 0.4); add(99.5, 103, 0.2, 0.2); }), 'mitigated'); // the zone was already used
  assert.equal(st((add: any) => add(106.2, 96.5, 0.2, 0.4)), 'invalidated');      // through the stop
  const r = smcSetup(smcBars((add: any) => add(106.2, 100.2, 0.2, 0.6)), 'bullish')!; assert.equal(r.ok, true); // in_zone still counts as fresh
  assert.equal(smcSetup(smcBars((add: any) => add(106.2, 99.5, 0.2, 0.4)), 'bullish')!.ok, false);
});
test('smc: an entry in the premium half of the range is rejected, and a missing shift gives no setup', () => {
  const T = 1_700_000_000, bars: any[] = [], add = (o: number, c: number, wu = 0.4, wd = 0.4) => bars.push({ time: T + bars.length * 900, open: o, close: c, high: Math.max(o, c) + wu, low: Math.min(o, c) - wd });
  const path = (from: number, to: number, n: number) => { for (let i = 0; i < n; i++) add(from + (to - from) * i / n, from + (to - from) * (i + 1) / n); };
  path(96, 100, 12); path(100, 103, 8); path(103, 101.8, 3); path(101.8, 99.9, 4); path(99.9, 101.4, 3); path(101.4, 99.6, 3);
  add(99.6, 99.0, 0.2, 0.2); add(99.0, 100.5, 0.3, 1.2); add(100.5, 104.2, 0.3, 0.2); add(104.2, 106.5, 0.3, 0.1); path(106.5, 106.0, 4); // low range: the zone sits above the midpoint of 94.9 to 106.9
  const s = smcSetup(bars, 'bullish'); if (s) assert.ok(s.checks.find(c => c.key === 'pd')!.ok === (s.entryMid <= s.range.eq));
  const nothing = smcBars().slice(0, 30); assert.equal(smcSetup(nothing, 'bullish'), null); assert.equal(smcRead(nothing), null);
});
test('smc: no lookahead (a setup found on a prefix is the same one the full series reports for that moment)', () => {
  const full = smcBars((add: any) => { add(106.2, 105.5, 0.2, 0.2); add(105.5, 106.0, 0.2, 0.2); });
  const a = smcSetup(full.slice(0, 47), 'bullish')!, later = smcSetup(full, 'bullish')!; // the stop floor uses the latest ATR, so only the structure is compared
  assert.equal(later.entryMid, a.entryMid); assert.equal(later.sweep.time, a.sweep.time); assert.equal(later.mss.time, a.mss.time); assert.deepEqual(later.entryZone, a.entryZone);
  assert.equal(smcSetup(full.slice(0, 40), 'bullish'), null, 'before the shift candle is known there is no setup');
});
test('smcRead: dealing range, premium/discount and a half-formed sweep', () => {
  const r = smcRead(smcBars(), 'bullish')!; assert.ok(r.range && r.range.high > r.range.low && ['discount', 'premium', 'equilibrium'].includes(r.zone!)); assert.ok(r.setup); assert.equal(r.partial, null);
  const upto = smcBars().slice(0, 40), w = smcRead(upto, 'bullish')!; // up to and including the sweep candle, shift not yet printed
  assert.equal(w.setup, null); assert.ok(w.partial && w.partial.direction === 'bullish' && /structure shift/.test(w.partial.text));
});

// ---- SMC evidence backtest and journal labelling ----
function smcSeries(tail: (add: (o: number, c: number, wu?: number, wd?: number) => void) => void) { // 110 warm-up candles, then the hand-built bullish setup, then the caller's moves
  const T = 1_700_000_000, bars: any[] = [], add = (o: number, c: number, wu = 0.4, wd = 0.4) => bars.push({ time: T + bars.length * 900, open: o, close: c, high: Math.max(o, c) + wu, low: Math.min(o, c) - wd });
  for (let i = 0; i < 110; i++) { const a = 90 + (26 * i) / 110, b = 90 + (26 * (i + 1)) / 110; add(a + (i % 2 ? 0.3 : -0.3), b); }
  const pattern = smcBars(); for (const x of pattern) bars.push({ ...x, time: T + bars.length * 900 }); tail(add); return bars;
}
test('scenarioBacktest (smc): a setup that fills and reaches its target is one winning trade with the setup\'s own levels', async () => {
  const c = smcSeries(add => { add(106.2, 99.2, 0.2, 0.3); add(99.2, 104, 0.3, 0.2); add(104, 109, 0.3, 0.2); for (let i = 0; i < 5; i++) add(109 + i * 0.1, 109.1 + i * 0.1, 0.2, 0.2); });
  const r = await scenarioBacktest(c, { tfSec: 900, strategy: 'smc', requireHtf: false });
  assert.equal(r.strategy, 'smc'); assert.equal(r.orders.placed, 1); assert.equal(r.orders.filled, 1); assert.equal(r.all.n, 1); const t = r.trades[0];
  assert.equal(t.dir, 'long'); assert.equal(t.reason, 'target'); assert.ok(Math.abs(t.entry - 99.3) < 1e-9); assert.ok(Math.abs(t.target - 107.9) < 1e-9); assert.ok(t.r > 3 && Math.abs(t.r - (107.9 - 99.3) / (99.3 - t.stop)) < 1e-9);
  assert.ok(t.signalTime < t.entryTime && t.entryTime <= t.exitTime); assert.ok(r.notes.some((n: string) => /SMC signal/.test(n)));
});
test('scenarioBacktest (smc): the same setup that then runs through the stop is a -1R loss, and HTF agreement can be required', async () => {
  const c = smcSeries(add => { add(106.2, 99.2, 0.2, 0.3); add(99.2, 95, 0.2, 0.5); for (let i = 0; i < 5; i++) add(95 - i * 0.1, 94.9 - i * 0.1, 0.2, 0.2); });
  const r = await scenarioBacktest(c, { tfSec: 900, strategy: 'smc', requireHtf: false }), t = r.trades[0];
  assert.equal(r.all.n, 1); assert.equal(t.reason, 'stop'); assert.ok(Math.abs(t.r + 1) < 1e-9);
  const strict = await scenarioBacktest(c, { tfSec: 900, strategy: 'smc', requireHtf: true }); assert.ok(strict.orders.placed <= r.orders.placed); // requiring HTF agreement can only remove orders
});
test('scenarioBacktest (smc): random data stays finite and accounted for', async () => {
  const c = walk(1000, 5), r = await scenarioBacktest(c, { tfSec: 900, strategy: 'smc', requireHtf: false });
  assert.equal(r.orders.placed, r.orders.filled + r.orders.missed + r.orders.unresolved); for (const t of r.trades) assert.ok(Number.isFinite(t.r) && t.entryTime > t.signalTime);
});
test('computePerformance labels SMC and confluence signals separately', () => {
  const rows = [{ id: 'a', symbol: 'R_75', direction: 'long', entry: 1, stop: 0.9, target: 1.3, result: 'win', source: 'signal', strategy: 'Auto signal: SMC model (sweep, structure shift, order block) on 15m', rMultiple: 3, closedAt: 2, createdAt: 1 },
    { id: 'b', symbol: 'R_75', direction: 'long', entry: 1, stop: 0.9, target: 1.3, result: 'loss', source: 'signal', strategy: 'Auto signal: confluence 72/70+ on 15m', rMultiple: -1, closedAt: 4, createdAt: 3 }];
  assert.deepEqual(computePerformance(rows).bySource.map((g: any) => g.key).sort(), ['auto SMC signal', 'auto confluence signal']);
});

// ---- scenario status helpers shared by the API (live alerts, signals) and the web (scanner, market page) ----
test('entryStatusAt / isChasing agree with scenario().status and the web liveEntry() at every price', () => {
  const sc = scenario(snapBull, demand, 4906, 20)! as any;
  for (let p = 4870; p <= 4990; p += 1.5) {
    const web = liveEntry(sc, p)!, api = entryStatusAt(sc, p);
    assert.equal(api, web.status, `status at ${p}`); assert.equal(isChasing(api!, web.distance, sc.atr), web.chasing, `chasing at ${p}`);
    assert.equal(scenario(snapBull, demand, p, 20)?.status ?? 'invalidated', api === null ? 'invalidated' : api === 'invalidated' ? 'invalidated' : api, `scenario().status at ${p}`);
  }
  assert.equal(entryStatusAt(null, 1), null); assert.equal(entryStatusAt({ ...sc, entryZone: null }, 4900), null);
  const bear = { bias: 'bearish', support: [4840, 4830], resistance: [], majorSupport: [], majorResistance: [] } as any, supply = { zones: [{ dir: 'supply', lower: 4896, upper: 4901 }], fvgs: [] } as any;
  const sb = scenario(bear, supply, 4860, 20)! as any; for (let p = 4820; p <= 4940; p += 2) assert.equal(entryStatusAt(sb, p), liveEntry(sb, p)!.status, `bearish at ${p}`);
});
test('scenarioView: distance in ATR and planned R:R for the scanner columns', () => {
  const sc = scenario(snapBull, demand, 4906, 20)! as any, v = scenarioView(sc, 4945.22);
  assert.ok(v.distanceAtr! > 2 && Math.abs(v.distanceAtr! - liveEntry(sc, 4945.22)!.distanceAtr!) < 1e-9); assert.equal(v.rr, sc.estimatedRR);
  assert.equal(scenarioView(sc, 4902).distanceAtr, 0); assert.equal(scenarioView(null, 1).distanceAtr, null); assert.equal(scenarioView(null, 1).rr, null);
});
test('scenario alerts: fire only on a change into the wanted status, honour the direction filter', () => {
  assert.equal(scnHit('scenario_in_zone', 'waiting', 'in_zone', undefined, 'bullish'), true);
  assert.equal(scnHit('scenario_in_zone', 'in_zone', 'in_zone', undefined, 'bullish'), false, 'standing state never fires');
  assert.equal(scnHit('scenario_in_zone', undefined, 'in_zone', undefined, 'bullish'), false, 'no baseline yet');
  assert.equal(scnHit('scenario_in_zone', 'waiting', 'waiting', undefined, 'bullish'), false);
  assert.equal(scnHit('scenario_in_zone', 'waiting', 'in_zone', 'bearish', 'bullish'), false); assert.equal(scnHit('scenario_in_zone', 'waiting', 'in_zone', 'bullish', 'bullish'), true);
  assert.equal(scnHit('scenario_invalidated', 'through_zone', 'invalidated', undefined, 'bearish'), true); assert.equal(scnHit('scenario_target', 'waiting', 'target_passed', undefined, 'bullish'), true);
  assert.equal(scnHit('scenario_invalidated', 'waiting', 'in_zone', undefined, 'bullish'), false); assert.equal(scnHit('scenario_in_zone', 'waiting', null, undefined, 'bullish'), false); assert.equal(scnHit('bos', 'waiting', 'in_zone', undefined, 'bullish'), false);
  assert.deepEqual(Object.keys(SCN_KIND).sort(), ['scenario_in_zone', 'scenario_invalidated', 'scenario_target']);
  // walk a price path through the live statuses: exactly one in-zone alert, at the moment price first reaches the zone
  const sc = scenario(snapBull, demand, 4925, 20)! as any; let before: string | null | undefined = entryStatusAt(sc, 4925), fired = 0;
  for (const p of [4925, 4915, 4908, 4903, 4901, 4902, 4890]) { const now = entryStatusAt(sc, p); if (scnHit('scenario_in_zone', before, now, undefined, sc.direction)) fired++; before = now; }
  assert.equal(fired, 1);
});
test('performance: auto signals are grouped by the scenario status recorded at signal time', () => {
  const sig = (id: string, st: string | undefined, r: number) => ({ id, symbol: 'R_75', direction: 'long', entry: 100, stop: 99, target: 102, result: r > 0 ? 'win' : 'loss', source: 'signal', tf: '5m', entryStatus: 'done', rMultiple: r, scenarioStatus: st, createdAt: Number(id) * 1000 });
  const p = computePerformance([sig('1', 'in_zone', 2), sig('2', 'in_zone', -1), sig('3', 'do_not_chase', -1), sig('4', undefined, 1), { id: '5', symbol: 'R_50', direction: 'long', entry: 1, stop: 0.5, target: 2, result: 'win', createdAt: 5000 }] as any[]);
  const by = Object.fromEntries(p.byScenario.map(g => [g.key, g.n])); assert.deepEqual(by, { in_zone: 2, do_not_chase: 1, unknown: 1 }); // the manual entry is not an auto signal
});

// ---- cost assumptions in simulations ----
test('costs: zero or missing costs reproduce the old results exactly', async () => {
  const c = walk(1500, 5), rules = { direction: 'long', require: ['bos'], window: 20, stopAtr: 1.5, rr: 2, maxHold: 50, htfFactor: 0 } as any;
  const a = runBacktest(c, rules, 900), b = runBacktest(c, rules, 900, { slipAtr: 0, feeR: 0 });
  assert.deepEqual(a.trades, b.trades); assert.ok(a.trades.length > 5, 'need trades to compare'); assert.deepEqual(a.costs, { slipAtr: 0, feeR: 0 });
  const e1 = await scenarioBacktest(walk(1200, 7), { tfSec: 900, minScore: 40 }), e2 = await scenarioBacktest(walk(1200, 7), { tfSec: 900, minScore: 40, costs: { slipAtr: 0, feeR: 0 } });
  assert.deepEqual(e1.trades, e2.trades);
});
test('costs: fees and slippage lower every trade, never change which trades happen, and are stated in the notes', async () => {
  const c = walk(1500, 5), rules = { direction: 'long', require: ['bos'], window: 20, stopAtr: 1.5, rr: 2, maxHold: 50, htfFactor: 0 } as any;
  const base = runBacktest(c, rules, 900), cost = runBacktest(c, rules, 900, { slipAtr: 0.1, feeR: 0.05 });
  assert.equal(cost.trades.length, base.trades.length); assert.deepEqual(cost.trades.map(t => t.entryTime), base.trades.map(t => t.entryTime));
  const stepAtr = 0.1 / 1.5; // slippage in R: 0.1 ATR against a 1.5 ATR stop
  let nt = 0, ns = 0;
  base.trades.forEach((t, i) => { const u = cost.trades[i]; assert.ok(u.r < t.r, `trade ${i} should be worse with costs`);
    if (t.reason === 'target') { nt++; assert.ok(Math.abs(t.r - u.r - (0.05 + stepAtr)) < 1e-9, 'target: market entry slips + fee, limit exit does not'); }
    if (t.reason === 'stop') { ns++; assert.ok(Math.abs(u.r - (-1 - 0.05 - 2 * stepAtr)) < 1e-9, 'stop: entry slips + exit slips + fee'); } });
  assert.ok(nt > 0 && ns > 0, `need both outcomes in the sample (targets ${nt}, stops ${ns})`);
  assert.ok(cost.all.totalR < base.all.totalR); assert.ok(cost.notes.some(n => /Costs modeled/.test(n))); assert.ok(base.notes.some(n => /not modeled/.test(n)));
  const e0 = await scenarioBacktest(walk(1200, 7), { tfSec: 900, minScore: 40 }), e1 = await scenarioBacktest(walk(1200, 7), { tfSec: 900, minScore: 40, costs: { slipAtr: 0.2, feeR: 0.1 } });
  assert.equal(e1.trades.length, e0.trades.length); e0.trades.forEach((t, i) => { assert.ok(e1.trades[i].r < t.r); if (t.reason === 'target') assert.ok(Math.abs(t.r - e1.trades[i].r - 0.1) < 1e-9, 'target fills are limit orders: only the fee applies'); if (t.reason === 'stop') assert.ok(e1.trades[i].r < t.r - 0.1 + 1e-9, 'stops slip as well as pay the fee'); });
  assert.ok(e1.all.totalR < e0.all.totalR); assert.ok(e1.notes.some(n => /Costs modeled/.test(n)));
});

// ---- scanner SMC status (same live-entry logic as the market page) ----
import { smcView } from '../apps/web/src/scenarioStatus.ts';
test('smcView: status follows the live price, partial and missing setups are labelled', () => {
  const base = { direction: 'bullish', status: 'waiting', ok: true, htfAligned: true, entryZone: { kind: 'order block', lower: 100, upper: 101 }, entryMid: 100.5, invalidation: 98, targets: [108], estimatedRR: 3, atr: 1 };
  assert.equal(smcView(base, 105).key, 'do_not_chase');
  assert.equal(smcView(base, 101.3).key, 'waiting');
  assert.equal(smcView(base, 100.6).key, 'in_zone');
  assert.equal(smcView(base, 99).key, 'through_zone');
  assert.equal(smcView(base, 97).key, 'invalidated');
  assert.equal(smcView(base, 109).key, 'target_passed');
  assert.equal(smcView({ ...base, status: 'mitigated' }, 105).key, 'mitigated');
  assert.equal(smcView({ ...base, status: 'stale' }, 105).key, 'stale');
  assert.equal(smcView({ partial: true, direction: 'bearish' }, 100).key, 'sweep_only');
  assert.equal(smcView(null, 100).key, 'none');
  assert.equal(smcView(base, 105).ok, true); assert.equal(smcView(base, 105).direction, 'bullish');
});
