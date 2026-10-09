import type { Candle, MarketAnalysisSnapshot, Bias, Swing, Fvg } from '@dmi/types';
import { ema, sma, rsi, macd, atr, roc, avgRange, volatilityState, candlePatterns } from '@dmi/indicators';
import { swings, classify, keyLevels, rangeState } from '@dmi/market-structure';
import { equalLevels, sweeps } from '@dmi/liquidity';
import { fvgs, zones, type Zone } from '@dmi/supply-demand';
const sgn = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
/** HTF structure from the same candles resampled x4 (closed, complete HTF candles only; no extra data requests). */
export function htfStructure(c: Candle[], factor = 4, left = 3, right = 3): string {
  if (c.length < 20) return 'unknown';
  const step = Math.min(...c.slice(1).map((x, i) => x.time - c[i].time).filter(d => d > 0)), hs = step * factor, b = new Map<number, { k: Candle; n: number }>();
  for (const x of c) { const t = Math.floor(x.time / hs) * hs, h = b.get(t); if (!h) b.set(t, { k: { time: t, open: x.open, high: x.high, low: x.low, close: x.close }, n: 1 }); else { h.k.high = Math.max(h.k.high, x.high); h.k.low = Math.min(h.k.low, x.low); h.k.close = x.close; h.n++; } }
  const full = [...b.values()].filter(h => h.n === factor).map(h => h.k);
  return full.length < 20 ? 'unknown' : classify(swings(full, left, right)).structure;
}
/**
 * Deterministic analysis. Confluence (0-100) is a transparent sum of 11 components, each counted only if it agrees with the bias direction:
 * HTF 15, structure 12, EMA 10, momentum 12, liquidity sweep 8, BOS/CHOCH 8, supply/demand 10, FVG 5, S/R location 8, volatility 5, risk/reward 7.
 * It is NOT a win probability.
 */
export function analyze(market: string, timeframe: string, c: Candle[], opts: { left?: number; right?: number } = {}) {
  const L = opts.left ?? 3, R = opts.right ?? 3, cl = c.map(x => x.close), n = cl.length - 1, price = cl[n], atrs = atr(c), atrNow = atrs[n];
  const e20 = ema(cl, 20)[n], e50 = ema(cl, 50)[n], e100 = ema(cl, 100)[n], e200 = ema(cl, 200)[n], sma50 = sma(cl, 50)[n], r = rsi(cl)[n], hist = macd(cl).hist[n], rc = roc(cl, 10)[n];
  const vol = volatilityState(c), rng = rangeState(c, atrNow), sw = swings(c, L, R), { structure, labels } = classify(sw), htf = htfStructure(c, 4, L, R), pats = candlePatterns(c);
  const ev = historyEvents(c, L, R).events, since = (k: number) => c[Math.max(0, n - k)].time;
  const lastBreak = [...ev].reverse().find(e => /^(BOS|CHOCH)/.test(e.kind) && e.time >= since(19)) ?? null;
  const sp = sweeps(c, sw), gaps = fvgs(c).filter(g => !g.filled).slice(-3), lastSweep = sp[sp.length - 1];
  const zs = zones(c, atrs).filter(z => z.status !== 'invalidated').slice(-4), levels = keyLevels(sw, price, atrNow);
  const recentSupport = sw.filter(s => s.type === 'low' && s.price < price).slice(-3).map(s => s.price), recentRes = sw.filter(s => s.type === 'high' && s.price > price).slice(-3).map(s => s.price);
  const emaDir = e20 > e50 && e50 > e200 ? 1 : e20 < e50 && e50 < e200 ? -1 : 0, st = structure === 'bullish' ? 1 : structure === 'bearish' ? -1 : 0;
  const mom = sgn(hist), rs = r > 55 ? 1 : r < 45 ? -1 : 0, hd = htf === 'bullish' ? 1 : htf === 'bearish' ? -1 : 0;
  const votes = st + emaDir + mom + rs + hd, dir = sgn(votes);
  const bias: Bias = votes >= 4 ? 'strong_bullish' : votes >= 1 ? 'bullish' : votes <= -4 ? 'strong_bearish' : votes <= -1 ? 'bearish' : 'neutral';
  const sweepDir = lastSweep ? (lastSweep.dir === 'bullish' ? 1 : -1) : 0, fvgDir = gaps.length ? (gaps[gaps.length - 1].dir === 'bullish' ? 1 : -1) : 0;
  const brkDir = lastBreak && lastBreak.time >= since(9) ? (lastBreak.dir === 'bullish' ? 1 : -1) : 0;
  const sdOk = dir === 1 ? zs.some(z => z.dir === 'demand' && price >= z.lower && price <= z.upper + atrNow) : dir === -1 ? zs.some(z => z.dir === 'supply' && price <= z.upper && price >= z.lower - atrNow) : false;
  const atLevel = dir === 1 ? [...recentSupport, ...levels.support.map(l => l.price)].some(p => price - p <= atrNow) : [...recentRes, ...levels.resistance.map(l => l.price)].some(p => p - price <= atrNow);
  const pa = priceActionZones(c, ev), sc = scenario({ bias, support: recentSupport, resistance: recentRes, majorSupport: levels.support.map(l => l.price), majorResistance: levels.resistance.map(l => l.price) }, { zones: zs, fvgs: gaps }, price, atrNow), rr = sc?.estimatedRR ?? 0;
  const p = (cond: boolean, pts: number) => (dir !== 0 && cond ? pts : 0);
  const parts = { htf: p(hd === dir, 15), structure: p(st === dir, 12), ema: p(emaDir === dir, 10), momentum: p(mom === dir, 6) + p(rs === dir, 6), liquidity: p(sweepDir === dir, 8), bosChoch: p(brkDir === dir, 8),
    supplyDemand: p(sdOk, 10), fvg: p(fvgDir === dir, 5), srLevels: p(atLevel, 8), volatility: p(vol.state === 'expanding', 5) + p(vol.state === 'normal', 2), riskReward: p(rr >= 2, 7) + p(rr >= 1.5 && rr < 2, 4) };
  const score = Object.values(parts).reduce((a, b) => a + b, 0), f = (x: number) => (Number.isFinite(x) ? x : null);
  const snapshot: MarketAnalysisSnapshot = {
    market, timeframe, bias, structure, momentum: hist > 0 ? 'positive' : 'negative', rsi: Number.isFinite(r) ? +r.toFixed(1) : null,
    emaAlignment: emaDir > 0 ? 'bullish' : emaDir < 0 ? 'bearish' : 'mixed', liquiditySweep: !!lastSweep, fvg: gaps.length > 0, support: recentSupport, resistance: recentRes, confluenceScore: score,
    htfStructure: htf, volatility: vol.state, rangeState: rng.state, majorSupport: levels.support.map(l => l.price), majorResistance: levels.resistance.map(l => l.price), patterns: pats.map(x => x.name), roc: Number.isFinite(rc) ? +rc.toFixed(2) : null,
  };
  const dist = (z: Zone) => (price < z.lower ? z.lower - price : price > z.upper ? price - z.upper : 0);
  return { snapshot, detail: { labels, break: lastBreak?.kind ?? null, sweeps: sp, fvgs: gaps, equalLevels: equalLevels(sw), scoreParts: parts, zones: zs.map(z => ({ ...z, distance: dist(z) })),
    indicators: { ema20: f(e20), ema50: f(e50), ema100: f(e100), ema200: f(e200), sma50: f(sma50), rsi: f(r), macdHist: f(hist), atr: f(atrNow), avgRange: f(avgRange(c)), roc10: f(rc), volatilityRatio: f(vol.ratio) },
    patterns: pats, range: rng, levels, priceActionZones: pa.slice(-10) } };
}
/** Multi-timeframe alignment from per-timeframe snapshots ordered HTF -> LTF. */
export function alignment(snaps: MarketAnalysisSnapshot[]) {
  const d = (b: Bias) => (b.includes('bullish') ? 1 : b.includes('bearish') ? -1 : 0);
  const dirs = snaps.map(s => d(s.bias)), nz = dirs.filter(Boolean);
  const state = nz.length === 0 ? 'neutral' : nz.every(x => x === nz[0]) && nz.length === dirs.length ? 'aligned' : nz.every(x => x === nz[0]) ? 'partial' : 'conflict';
  return { state, direction: nz.length ? (nz[0] > 0 ? 'bullish' : 'bearish') : 'neutral', byTimeframe: snaps.map(s => ({ tf: s.timeframe, bias: s.bias, structure: s.structure })) };
}

export interface HistEvent { time: number; kind: string; dir: 'bullish' | 'bearish' | 'neutral'; price: number }
/**
 * Historical replay engine. Walks candles in order and only uses information available at each candle:
 * a swing becomes usable `right` candles after it forms; BOS/CHOCH need a close beyond the latest unbroken swing;
 * a sweep is a wick beyond an unconsumed swing with the close back inside.
 */
export function historyEvents(c: Candle[], left = 3, right = 3) {
  const sw = swings(c, left, right), events: HistEvent[] = [];
  let pool: Swing[] = [], k = 0, trend = 0;
  for (let i = 0; i < c.length; i++) {
    while (k < sw.length && sw[k].i + right <= i) pool.push(sw[k++]);
    const x = c[i], seen = new Set<string>();
    for (const s of pool) {
      const dir = s.type === 'high' ? 'bearish' : 'bullish';
      const swept = s.type === 'high' ? x.high > s.price && x.close <= s.price : x.low < s.price && x.close >= s.price;
      if (swept && !seen.has(dir)) { seen.add(dir); events.push({ time: x.time, kind: `SWEEP_${dir.toUpperCase()}`, dir, price: s.price }); pool = pool.filter(p => p !== s); }
    }
    const hi = [...pool].reverse().find(s => s.type === 'high'), lo = [...pool].reverse().find(s => s.type === 'low');
    if (hi && x.close > hi.price) { events.push({ time: x.time, kind: trend < 0 ? 'CHOCH_BULLISH' : 'BOS_BULLISH', dir: 'bullish', price: hi.price }); trend = 1; pool = pool.filter(s => !(s.type === 'high' && s.price < x.close)); }
    else if (lo && x.close < lo.price) { events.push({ time: x.time, kind: trend > 0 ? 'CHOCH_BEARISH' : 'BOS_BEARISH', dir: 'bearish', price: lo.price }); trend = -1; pool = pool.filter(s => !(s.type === 'low' && s.price > x.close)); }
  }
  const gaps = fvgs(c), zs = zones(c, atr(c));
  for (const g of gaps) {
    events.push({ time: c[g.i].time, kind: `FVG_${g.dir.toUpperCase()}`, dir: g.dir, price: (g.upper + g.lower) / 2 });
    if (g.filledI !== undefined) events.push({ time: c[g.filledI].time, kind: 'FVG_FILLED', dir: 'neutral', price: (g.upper + g.lower) / 2 });
  }
  for (const z of zs) events.push({ time: c[z.i + 1].time, kind: `ZONE_${z.dir.toUpperCase()}`, dir: z.dir === 'demand' ? 'bullish' : 'bearish', price: (z.upper + z.lower) / 2 });
  events.sort((a, b) => a.time - b.time);
  return {
    events,
    swings: sw.map(s => ({ type: s.type, price: s.price, time: c[s.i].time, confirmedAt: c[Math.min(s.i + right, c.length - 1)].time })),
    fvgs: gaps.map(g => ({ dir: g.dir, upper: g.upper, lower: g.lower, time: c[g.i].time, filledAt: g.filledI !== undefined ? c[g.filledI].time : null })),
    zones: zs.map(z => ({ dir: z.dir, upper: z.upper, lower: z.lower, time: c[z.i + 1].time, strength: z.strength, tests: z.tests, status: z.status })),
  };
}

// ---------------- Deterministic backtesting ----------------
export interface BtRules { direction: 'long' | 'short'; require: string[]; window: number; stopAtr: number; rr: number; maxHold: number; htfFactor: number }
export interface Trade { entryTime: number; exitTime: number; dir: string; entry: number; stop: number; target: number; exit: number; reason: 'target' | 'stop' | 'timeout'; r: number; bars: number }
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
export function tradeStats(t: Trade[]) {
  const rs = t.map(x => x.r), wins = rs.filter(r => r > 0), losses = rs.filter(r => r < 0);
  let eq = 0, peak = 0, dd = 0, cw = 0, cl = 0, mw = 0, ml = 0;
  for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); cw = r > 0 ? cw + 1 : 0; cl = r < 0 ? cl + 1 : 0; mw = Math.max(mw, cw); ml = Math.max(ml, cl); }
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  return { setups: t.length, winners: wins.length, losers: losses.length, winRate: t.length ? wins.length / t.length : null, totalR: eq, avgR: t.length ? eq / t.length : null,
    profitFactor: gl > 0 ? wins.reduce((a, b) => a + b, 0) / gl : null, payoff: wins.length && losses.length ? mean(wins) / Math.abs(mean(losses)) : null,
    maxDrawdownR: dd, maxConsecWins: mw, maxConsecLosses: ml, avgBars: t.length ? mean(t.map(x => x.bars)) : null };
}
/** Optional trading-cost assumptions for simulations. slipAtr: adverse slippage as a fraction of ATR (market entries, stop and timeout exits). feeR: flat cost per trade in R (fees + spread). Both default to 0. */
export interface Costs { slipAtr?: number; feeR?: number }
const costOf = (c?: Costs) => ({ slip: Math.max(0, Number(c?.slipAtr) || 0), fee: Math.max(0, Number(c?.feeR) || 0) });
const costNote = (slip: number, fee: number, entryNote: string) => slip || fee
  ? `Costs modeled (your assumptions, not Deriv's actual charges): slippage ${slip} ATR against you on ${entryNote}stop and timeout exits, plus ${fee} R per trade for fees and spread. Spikes on Boom/Crash/Jump indices can still gap through stops, so real losses can exceed 1R.`
  : 'Fees, spread and slippage are not modeled. Spikes on Boom/Crash/Jump indices can gap through stops, so real losses can exceed 1R.';
const evKey = (k: string) => k.startsWith('SWEEP') ? 'sweep' : k.startsWith('BOS') ? 'bos' : k.startsWith('CHOCH') ? 'choch' : k.startsWith('FVG_') && k !== 'FVG_FILLED' ? 'fvg' : k.startsWith('ZONE') ? 'zone' : '';
/**
 * Rule: all required events (aligned with `direction`) occurred within the last `window` candles (and HTF trend agrees, if enabled).
 * Signal on candle close; entry at the NEXT candle open; ATR stop; target = rr x risk; one trade at a time.
 * Same-candle stop+target = stop. Trades that can't resolve before data ends are discarded.
 */
export function runBacktest(c: Candle[], rules: BtRules, tfSec: number, costs?: Costs) {
  const { slip, fee } = costOf(costs);
  const long = rules.direction === 'long', want = long ? 'bullish' : 'bearish', need = [...new Set(rules.require)];
  const ev = historyEvents(c).events, idxOf = new Map(c.map((x, i) => [x.time, i]));
  let htfEv: { at: number; dir: string }[] = [];
  if (rules.htfFactor > 1) {
    const hs = tfSec * rules.htfFactor, b = new Map<number, Candle>();
    for (const x of c) { const t = Math.floor(x.time / hs) * hs, h = b.get(t); if (!h) b.set(t, { time: t, open: x.open, high: x.high, low: x.low, close: x.close }); else { h.high = Math.max(h.high, x.high); h.low = Math.min(h.low, x.low); h.close = x.close; } }
    const hc = [...b.values()]; if (c[0].time % hs) hc.shift();
    if (hc.length >= 20) htfEv = historyEvents(hc).events.filter(e => ['bos', 'choch'].includes(evKey(e.kind))).map(e => ({ at: e.time + hs, dir: e.dir }));
  }
  const a = atr(c, 14), trades: Trade[] = [], last: Record<string, number> = {}; let e = 0, hp = 0, htf = '';
  for (let i = 30; i < c.length - 1; i++) {
    while (e < ev.length && ev[e].time <= c[i].time) { const x = ev[e++], k = evKey(x.kind); if (k && x.dir === want) last[k] = idxOf.get(x.time)!; }
    while (hp < htfEv.length && htfEv[hp].at <= c[i].time + tfSec) htf = htfEv[hp++].dir; // HTF event usable only once its candle has closed
    if (rules.htfFactor > 1 && htf !== want) continue;
    if (!need.every(k => last[k] !== undefined && i - last[k] < rules.window)) continue;
    const entry = c[i + 1].open, risk = rules.stopAtr * a[i]; if (!(risk > 0)) continue;
    const stop = long ? entry - risk : entry + risk, target = long ? entry + rules.rr * risk : entry - rules.rr * risk;
    const sl = slip * a[i], fill = long ? entry + sl : entry - sl; // market entry fills slightly worse than the open; stop/target stay where the rule placed them
    let done: Trade | null = null;
    for (let j = i + 1; j <= Math.min(i + rules.maxHold, c.length - 1); j++) {
      const x = c[j], sHit = long ? x.low <= stop : x.high >= stop, tHit = long ? x.high >= target : x.low <= target, fin = j === i + rules.maxHold;
      if (sHit || tHit || fin) {
        const raw = sHit ? stop : tHit ? target : x.close, exit = sHit || !tHit ? (long ? raw - sl : raw + sl) : raw; // targets are limit fills (no slippage); stops and timeouts slip
        done = { entryTime: c[i + 1].time, exitTime: x.time, dir: rules.direction, entry: fill, stop, target, exit, reason: sHit ? 'stop' : tHit ? 'target' : 'timeout', r: (long ? exit - fill : fill - exit) / risk - fee, bars: j - i };
        i = j; break;
      }
    }
    if (!done) break; trades.push(done);
  }
  const split = c[Math.floor(c.length * 0.7)].time; let cum = 0;
  const equity = trades.map(t => ({ t: t.exitTime, r: (cum += t.r) }));
  const all = tradeStats(trades);
  const notes = ['Historical simulation only: not a prediction or guarantee of future results.',
    costNote(slip, fee, 'the market entry, '),
    'If a candle touches both stop and target, it is counted as a stop.',
    'Rules tuned on this data can be overfit: compare in-sample (first 70%) with out-of-sample (last 30%).'];
  if (all.setups < 30) notes.unshift('Fewer than 30 setups: results are not statistically meaningful.');
  return { candles: c.length, from: c[0].time, to: c[c.length - 1].time, splitTime: split, rules, costs: { slipAtr: slip, feeR: fee }, all, inSample: tradeStats(trades.filter(t => t.entryTime < split)),
    outOfSample: tradeStats(trades.filter(t => t.entryTime >= split)), trades: trades.slice(-500), equity: equity.slice(-500), notes };
}

/**
 * Deterministic "potential scenario": nearest unfilled zone/FVG on the pullback side of the bias, invalidation beyond it,
 * targets at the next key levels. Analytical only; returns null when conditions are neutral.
 * The stop sits beyond the zone's far edge by at least STOP_ATR x ATR (so it is not inside normal candle noise), and the result says whether the
 * entry is still valid at the current price (waiting / in zone / through zone / invalidated / target passed).
 */
export const STOP_ATR = 0.75;
export function scenario(snap: Pick<MarketAnalysisSnapshot, 'bias' | 'support' | 'resistance' | 'majorSupport' | 'majorResistance'>, detail: { zones: Zone[]; fvgs: Fvg[] }, price: number, atr?: number | null) {
  if (snap.bias === 'neutral') return null;
  const bull = snap.bias.includes('bullish'), dir = bull ? 'bullish' : 'bearish', a = typeof atr === 'number' && Number.isFinite(atr) && atr > 0 ? atr : 0;
  // Candidate entries: unfilled demand/supply zones and FVGs on the pullback side. A zone stays a candidate while price is above/below it, inside it, or through it
  // but not yet beyond its stop, so the status can say "waiting", "in zone", "through zone" or "invalidated" instead of the scenario silently vanishing.
  const stopBuf = (lo: number, hi: number) => Math.max((hi - lo) * 0.25, price * 0.0001, STOP_ATR * a);
  const all = [...detail.zones.filter(z => (bull ? z.dir === 'demand' : z.dir === 'supply')).map(z => ({ kind: z.dir === 'demand' ? 'demand zone' : 'supply zone', lo: z.lower, hi: z.upper })),
    ...detail.fvgs.filter(g => (bull ? g.dir === 'bullish' : g.dir === 'bearish')).map(g => ({ kind: `${g.dir} FVG`, lo: g.lower, hi: g.upper }))];
  const alive = all.filter(z => (bull ? price > z.lo - stopBuf(z.lo, z.hi) : price < z.hi + stopBuf(z.lo, z.hi))), ahead = alive.filter(z => (bull ? z.lo <= price : z.hi >= price));
  const cands = (ahead.length ? ahead : alive).sort((a, b) => bull ? b.hi - a.hi : a.lo - b.lo);
  const note = 'Analytical scenario only: not a signal or a prediction. The user makes the final decision.';
  const confirmation = bull ? 'Bullish continuation (for example a bullish BOS or a reaction from the zone) is required.' : 'Bearish continuation (for example a bearish BOS or a reaction from the zone) is required.';
  const z = cands[0];
  if (!z) return { direction: dir, entryZone: null, note: `${note} No unfilled zone or FVG was found on the pullback side, so no entry zone is identified.`, confirmation };
  const mid = (z.lo + z.hi) / 2, buf = stopBuf(z.lo, z.hi), invalidation = bull ? z.lo - buf : z.hi + buf;
  const uniq = (a: number[]) => [...new Set(a.map(x => +x.toFixed(6)))], targets = (bull ? uniq([...snap.resistance, ...(snap.majorResistance ?? [])]).filter(r => r > mid).sort((a, b) => a - b) : uniq([...snap.support, ...(snap.majorSupport ?? [])]).filter(s => s < mid).sort((a, b) => b - a)).slice(0, 2);
  const risk = Math.abs(mid - invalidation), rr = targets.length && risk > 0 ? Math.abs(targets[0] - mid) / risk : null;
  // Is the entry still valid at the current price? distance > 0 means price has not yet pulled back to the zone.
  const distance = bull ? price - z.hi : z.lo - price;
  const status = (bull ? price <= invalidation : price >= invalidation) ? 'invalidated' : targets.length && (bull ? price >= targets[0] : price <= targets[0]) ? 'target_passed'
    : distance > 0 ? 'waiting' : (bull ? price >= z.lo : price <= z.hi) ? 'in_zone' : 'through_zone';
  const warnings: string[] = [];
  if (rr !== null && rr < 1.5) warnings.push('Estimated R:R is below 1.5: the first target is close relative to the stop.');
  if (!targets.length) warnings.push('No target level was found beyond the entry.');
  if (!a) warnings.push('Volatility (ATR) was unavailable, so the stop uses only the zone width.');
  return { direction: dir, entryZone: { kind: z.kind, lower: z.lo, upper: z.hi }, entryMid: mid, invalidation, risk, targets, estimatedRR: rr, confirmation, note, status, distance, atr: a || null, warnings };
}

/** "Chasing" = entry still ahead of the zone by more than this many ATR. Keep equal to the web helper (tested). */
export const CHASE_ATR = 0.5;
export const isChasing = (status: string | undefined, distance: number | undefined, atr: number | null | undefined) => status === 'waiting' && !!atr && (distance ?? 0) > CHASE_ATR * atr;
/** Status of a scenario's entry at an arbitrary (live) price. Same rules as scenario().status and the web liveEntry(). Null when there is no entry zone. */
export function entryStatusAt(sc: { direction: string; entryZone: { lower: number; upper: number } | null; invalidation?: number; targets?: number[] } | null | undefined, price: number): 'waiting' | 'in_zone' | 'through_zone' | 'invalidated' | 'target_passed' | null {
  if (!sc?.entryZone || !Number.isFinite(price) || sc.invalidation === undefined) return null;
  const bull = sc.direction === 'bullish', z = sc.entryZone, t1 = sc.targets?.[0], distance = bull ? price - z.upper : z.lower - price;
  if (bull ? price <= sc.invalidation : price >= sc.invalidation) return 'invalidated';
  if (t1 !== undefined && (bull ? price >= t1 : price <= t1)) return 'target_passed';
  return distance > 0 ? 'waiting' : price >= z.lower && price <= z.upper ? 'in_zone' : 'through_zone';
}

/** What happened on the candle that just closed (events stamped on the last candle only), plus the RSI pair needed for threshold crossings. */
export function closedCandle(c: Candle[]) {
  const n = c.length - 1, last = c[n].time, events: HistEvent[] = historyEvents(c).events.filter(e => e.time === last);
  const cl = c.map(x => x.close);
  if (n >= 60) { // EMA warm-up: ignore the first candles
    const e20 = ema(cl, 20), e50 = ema(cl, 50), now = e20[n] - e50[n], before = e20[n - 1] - e50[n - 1];
    if (now > 0 && before <= 0) events.push({ time: last, kind: 'EMA_CROSS_BULLISH', dir: 'bullish', price: cl[n] });
    if (now < 0 && before >= 0) events.push({ time: last, kind: 'EMA_CROSS_BEARISH', dir: 'bearish', price: cl[n] });
  }
  const r = rsi(cl);
  return { events, rsi: [r[n - 1], r[n]] as [number, number] };
}

/**
 * Order-block-style "potential zones": the last opposite-coloured candle (within 10 candles) before a BOS/CHOCH, with retest count and invalidation.
 * These are potential reaction areas, not guaranteed institutional order blocks.
 */
export function priceActionZones(c: Candle[], events: HistEvent[]) {
  const out: { dir: 'bullish' | 'bearish'; upper: number; lower: number; time: number; createdAt: number; retests: number; status: 'fresh' | 'tested' | 'invalidated' }[] = [], idx = new Map(c.map((x, i) => [x.time, i]));
  for (const e of events) {
    if (!/^(BOS|CHOCH)/.test(e.kind) || e.dir === 'neutral') continue;
    const k = idx.get(e.time)!, bull = e.dir === 'bullish';
    for (let j = k - 1; j >= Math.max(0, k - 10); j--) {
      if (!(bull ? c[j].close < c[j].open : c[j].close > c[j].open)) continue;
      const z = { dir: e.dir, upper: c[j].high, lower: c[j].low, time: c[j].time, createdAt: e.time, retests: 0, status: 'fresh' as 'fresh' | 'tested' | 'invalidated' };
      for (let m = k + 1; m < c.length; m++) {
        if (bull ? c[m].close < z.lower : c[m].close > z.upper) { z.status = 'invalidated'; break; }
        if (c[m].low <= z.upper && c[m].high >= z.lower) { z.retests++; z.status = 'tested'; }
      }
      out.push(z); break;
    }
  }
  return out;
}

// ---------------- Statistics shared by the performance report and the scenario evidence check ----------------
/** Summary of a list of R-multiples (one per closed trade). Ranges are ~95% and rough: they widen a lot with few trades. */
export function summarizeR(rs: number[]) {
  const n = rs.length, wins = rs.filter(r => r > 0), losses = rs.filter(r => r < 0), sum = rs.reduce((a, b) => a + b, 0), avg = n ? sum / n : null;
  let eq = 0, peak = 0, dd = 0, cw = 0, cl = 0, mw = 0, ml = 0;
  for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); cw = r > 0 ? cw + 1 : 0; cl = r < 0 ? cl + 1 : 0; mw = Math.max(mw, cw); ml = Math.max(ml, cl); }
  const sd = n > 1 && avg !== null ? Math.sqrt(rs.reduce((a, r) => a + (r - avg) ** 2, 0) / (n - 1)) : null, se = sd !== null ? sd / Math.sqrt(n) : null;
  const gw = wins.reduce((a, b) => a + b, 0), gl = Math.abs(losses.reduce((a, b) => a + b, 0)), z = 1.96;
  let wLow: number | null = null, wHigh: number | null = null;
  if (n) { const p = wins.length / n, d = 1 + z * z / n, ctr = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; wLow = Math.max(0, ctr - half); wHigh = Math.min(1, ctr + half); } // Wilson interval
  const payoff = wins.length && losses.length ? mean(wins) / Math.abs(mean(losses)) : null;
  return { n, wins: wins.length, losses: losses.length, breakeven: n - wins.length - losses.length, winRate: n ? wins.length / n : null, winRateLow: wLow, winRateHigh: wHigh,
    avgR: avg, totalR: sum, sd, ciLow: avg !== null && se !== null ? avg - z * se : null, ciHigh: avg !== null && se !== null ? avg + z * se : null,
    profitFactor: gl > 0 ? gw / gl : null, payoff, breakevenWinRate: payoff ? 1 / (1 + payoff) : null, maxDrawdownR: dd, maxWinStreak: mw, maxLossStreak: ml };
}
export type RSummary = ReturnType<typeof summarizeR>;
/** Plain-language read of a result. Deliberately conservative: "no edge" is the default unless the data clearly says otherwise. */
export function evidenceVerdict(all: RSummary, oos?: RSummary | null): { level: 'insufficient' | 'negative' | 'no_edge' | 'positive'; text: string } {
  if (all.n < 30) return { level: 'insufficient', text: `Only ${all.n} closed trades: too few to conclude anything. Results this small are mostly luck.` };
  if (all.ciHigh !== null && all.ciHigh <= 0) return { level: 'negative', text: 'Lost money on average, and the 95% range for average R is entirely below zero. This rule has not worked on this data.' };
  if (all.ciLow !== null && all.ciLow > 0 && oos && oos.n >= 10 && (oos.avgR ?? 0) > 0) return { level: 'positive', text: 'Positive on average and in the out-of-sample part. Encouraging but not proof: fees and slippage are not included, and markets change.' };
  return { level: 'no_edge', text: 'No measurable edge: the 95% range for average R includes zero (or the out-of-sample part is not positive), so these results are consistent with luck.' };
}

// ---------------- Trade-signal rules shared by the live signal alert, the outcome tracker and the evidence backtest ----------------
export const SIGNAL_RULES = { minRR: 1.5, fillCandles: 20, holdCandles: 100 } as const;
export interface EvidenceOpts { tfSec: number; symbol?: string; tf?: string; minScore?: number; fillCandles?: number; holdCandles?: number; strategy?: 'confluence' | 'smc'; requireHtf?: boolean; costs?: Costs }
/**
 * Backtest of the exact rule behind "Trade signal" alerts (strategy 'confluence', default) or "SMC signal" alerts (strategy 'smc': a complete sweep -> shift -> order block setup that passes its own checks): on each closed candle, compute the analysis and scenario from data up to that candle only;
 * when confluence >= minScore, HTF structure agrees, R:R >= 1.5 and the entry is still ahead of/inside the zone, place a LIMIT order at the zone midpoint.
 * The order fills if price touches it within `fillCandles`; then the stop/target of the scenario apply for up to `holdCandles`. One order at a time.
 * Conservative fills: on the fill candle only the stop is checked; a candle touching stop and target counts as a stop; stops that gap fill at the stop price (optimistic for spikes).
 * Orders that never fill count as "missed"; trades still unresolved when data ends are discarded.
 * Async only so a long run can yield to the event loop (pass yieldFn); the logic is otherwise synchronous and deterministic.
 */
export async function scenarioBacktest(c: Candle[], o: EvidenceOpts, yieldFn?: () => Promise<void>) {
  const { slip, fee } = costOf(o.costs), minScore = o.minScore ?? 70, fillN = o.fillCandles ?? SIGNAL_RULES.fillCandles, holdN = o.holdCandles ?? SIGNAL_RULES.holdCandles, last = c.length - 1;
  const trades: (Trade & { signalTime: number; score: number })[] = []; let placed = 0, filled = 0, missed = 0, unresolved = 0, evals = 0;
  for (let i = 120; i < last; i++) {
    if (yieldFn && ++evals % 25 === 0) await yieldFn();
    let long: boolean, entry: number, stop: number, target: number, score: number, atrNow = 0;
    const win = c.slice(Math.max(0, i - 499), i + 1);
    if (o.strategy === 'smc') {
      let ss: SmcSetup | null; try { ss = smcSetup(win, htfStructure(win)); } catch { continue; }
      if (!ss || !ss.ok || !ss.targets.length || (o.requireHtf !== false && ss.htfAligned !== true)) continue;
      long = ss.direction === 'bullish'; entry = ss.entryMid; stop = ss.invalidation; target = ss.targets[0]; atrNow = ss.atr ?? 0; score = ss.checks.filter(x => x.ok === true).length;
    } else {
      let an: ReturnType<typeof analyze>, sc: ReturnType<typeof scenario>;
      try { an = analyze(o.symbol ?? 'X', o.tf ?? '15m', win); sc = scenario(an.snapshot, { zones: an.detail.zones, fvgs: an.detail.fvgs }, c[i].close, an.detail.indicators.atr); } catch { continue; }
      if (!sc?.entryZone || !sc.targets?.length || !((sc.estimatedRR ?? 0) >= SIGNAL_RULES.minRR) || an.snapshot.confluenceScore < minScore || an.snapshot.htfStructure !== sc.direction || !['waiting', 'in_zone'].includes(sc.status as string)) continue;
      long = sc.direction === 'bullish'; entry = sc.entryMid as number; stop = sc.invalidation as number; target = sc.targets[0]; atrNow = sc.atr ?? 0; score = an.snapshot.confluenceScore;
    }
    const risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    placed++;
    let fillIdx = -1, ended = i; // ended = index where this order's story finished
    for (let j = i + 1; j <= Math.min(i + fillN, last); j++) {
      const x = c[j], touched = long ? x.low <= entry : x.high >= entry, ran = long ? x.high >= target : x.low <= target;
      if (touched) { fillIdx = j; break; }
      if (ran) { missed++; ended = j; fillIdx = -2; break; } // the move happened without a pullback to the entry
    }
    if (fillIdx === -2) { i = ended; continue; }
    if (fillIdx === -1) { if (i + fillN > last) { unresolved++; break; } missed++; i += fillN; continue; } // never filled in time
    filled++;
    let exit = NaN, reason: Trade['reason'] = 'timeout', exitIdx = -1;
    const fc = c[fillIdx]; if (long ? fc.low <= stop : fc.high >= stop) { exit = stop; reason = 'stop'; exitIdx = fillIdx; }
    for (let k = fillIdx + 1; exitIdx < 0 && k <= Math.min(fillIdx + holdN, last); k++) {
      const x = c[k], sHit = long ? x.low <= stop : x.high >= stop, tHit = long ? x.high >= target : x.low <= target;
      if (sHit || tHit) { exit = sHit ? stop : target; reason = sHit ? 'stop' : 'target'; exitIdx = k; } else if (k === fillIdx + holdN) { exit = x.close; reason = 'timeout'; exitIdx = k; }
    }
    if (exitIdx < 0) { unresolved++; break; }
    const sl = slip * atrNow, exitAdj = reason === 'target' ? exit : long ? exit - sl : exit + sl; // limit entry and target: no slippage; stop and timeout exits slip
    trades.push({ signalTime: c[i].time, score, entryTime: c[fillIdx].time, exitTime: c[exitIdx].time, dir: long ? 'long' : 'short', entry, stop, target, exit: exitAdj, reason, r: (long ? exitAdj - entry : entry - exitAdj) / risk - fee, bars: exitIdx - i });
    i = exitIdx;
  }
  const split = c[Math.floor(c.length * 0.7)].time, rs = trades.map(t => t.r), oosT = trades.filter(t => t.signalTime >= split), isT = trades.filter(t => t.signalTime < split);
  const all = summarizeR(rs), oos = summarizeR(oosT.map(t => t.r)), ins = summarizeR(isT.map(t => t.r));
  const notes = [`Historical simulation of the same rule the ${o.strategy === 'smc' ? 'SMC signal' : 'Trade signal'} alert uses: not a prediction or a guarantee.`,
    'Orders are limit orders at the zone midpoint. On the fill candle only the stop is checked; a candle touching both stop and target counts as a stop.',
    costNote(slip, fee, ''),
    'This covers only the candles loaded for this check. A different period can give different results.'];
  if (all.n < 30) notes.unshift('Fewer than 30 trades: results are not statistically meaningful.');
  return { strategy: o.strategy ?? 'confluence', candles: c.length, from: c[0].time, to: c[last].time, splitTime: split, minScore, fillCandles: fillN, holdCandles: holdN, costs: { slipAtr: slip, feeR: fee },
    orders: { placed, filled, missed, unresolved, fillRate: filled + missed ? filled / (filled + missed) : null },
    all, inSample: ins, outOfSample: oos, verdict: evidenceVerdict(all, oos), trades: trades.slice(-200), notes };
}

// ---------------- Smart Money Concepts (SMC) model ----------------
/**
 * Deterministic SMC setup, using only closed candles up to the last one (no lookahead; every swing is confirmed by `right` later candles).
 * Sequence (bullish; bearish is the mirror):
 *   1. Liquidity sweep: a candle wicks below an untouched swing low and closes back above it.
 *   2. Market structure shift (MSS) with displacement: within `maxGap` candles a close above the last swing high that preceded the sweep,
 *      with an impulse (a bullish fair value gap, or a candle body of at least 1 ATR).
 *   3. Entry zone: the last bearish candle before the move (order block); the displacement FVG is used if none is found.
 *   4. Premium/discount: a long entry must sit in the lower half of the dealing range (a short in the upper half).
 *   5. Stop beyond the sweep extreme and the zone (at least 0.75 ATR from the entry); targets are untouched swing highs above the entry.
 * Analysis only: this is a rule-based reading of the chart, not evidence that the setup makes money.
 */
export const SMC = { left: 3, right: 3, window: 200, maxGap: 12, maxAge: 40, obBack: 5, rangeBack: 40, stopBufAtr: 0.25, minStopAtr: 0.75, minRR: 1.5 } as const;
export type SmcStatus = 'waiting' | 'in_zone' | 'entry_passed' | 'invalidated' | 'target_passed' | 'mitigated' | 'stale';
export interface SmcSetup {
  direction: 'bullish' | 'bearish';
  sweep: { time: number; level: number; extreme: number }; mss: { time: number; level: number; displacement: 'fvg' | 'body' };
  entryZone: { kind: 'order block' | 'FVG'; lower: number; upper: number }; entryMid: number; invalidation: number; risk: number; targets: number[]; estimatedRR: number | null;
  range: { low: number; high: number; eq: number }; status: SmcStatus; distance: number; ageCandles: number; atr: number;
  checks: { key: string; label: string; ok: boolean | null }[]; ok: boolean; htfAligned: boolean | null;
}
const smcSwept = (d: Candle[], sw: Swing[], bull: boolean, from: number, to: number) => { // one sweep per swing: the first candle that trades through it, if it closes back inside
  const out: { s: number; level: number }[] = [];
  for (const x of sw) {
    if (x.type !== (bull ? 'low' : 'high')) continue;
    let fb = -1; for (let j = x.i + 1; j < d.length; j++) if (bull ? d[j].low < x.price : d[j].high > x.price) { fb = j; break; }
    if (fb >= from && fb <= to && (bull ? d[fb].close > x.price : d[fb].close < x.price)) out.push({ s: fb, level: x.price });
  }
  return out.sort((p, q) => q.s - p.s); // most recent first
};
function smcCore(c: Candle[], htf?: string) {
  if (c.length < 40) return null;
  const d = c.slice(-SMC.window), L = d.length - 1, A = atr(d, 14)[L];
  if (!Number.isFinite(A) || !(A > 0)) return null;
  const sw = swings(d, SMC.left, SMC.right), gaps = fvgs(d), cands: (SmcSetup & { m: number })[] = [], sweepsSeen: { dir: 'bullish' | 'bearish'; s: number; level: number }[] = [], last = d[L];
  for (const dir of ['bullish', 'bearish'] as const) {
    const bull = dir === 'bullish', from = Math.max(10, L - SMC.maxAge - SMC.maxGap);
    for (const sp of smcSwept(d, sw, bull, from, L)) {
      sweepsSeen.push({ dir, s: sp.s, level: sp.level });
      const s = sp.s, bl = [...sw].reverse().find(x => x.type === (bull ? 'high' : 'low') && x.i + SMC.right <= s && x.i < s); // the swing the shift must break
      if (!bl || s >= L) continue;
      let m = -1; for (let j = s + 1; j <= Math.min(s + SMC.maxGap, L); j++) if (bull ? d[j].close > bl.price : d[j].close < bl.price) { m = j; break; }
      if (m < 0) continue;
      const gap = [...gaps].reverse().find(g => g.dir === dir && g.i > s && g.i <= m + 1), body = Math.abs(d[m].close - d[m].open) >= A, disp: 'fvg' | 'body' | null = gap ? 'fvg' : body ? 'body' : null;
      if (!disp) continue;
      let ex = Math.max(0, s - 1); for (let j = ex; j < m; j++) if (bull ? d[j].low < d[ex].low : d[j].high > d[ex].high) ex = j; // candle that made the extreme the move started from
      let ob: { lower: number; upper: number } | null = null;
      for (let j = ex; j >= Math.max(0, ex - SMC.obBack); j--) if (bull ? d[j].close < d[j].open : d[j].close > d[j].open) { ob = { lower: d[j].low, upper: d[j].high }; break; }
      const zone = ob ? { kind: 'order block' as const, ...ob } : gap ? { kind: 'FVG' as const, lower: gap.lower, upper: gap.upper } : null; if (!zone) continue;
      let rHigh = -Infinity, rLow = Infinity; for (let j = Math.max(0, s - SMC.rangeBack); j <= L; j++) { rHigh = Math.max(rHigh, d[j].high); rLow = Math.min(rLow, d[j].low); }
      const eq = (rHigh + rLow) / 2, mid = (zone.lower + zone.upper) / 2;
      let extreme = bull ? Infinity : -Infinity; for (let j = s; j <= m; j++) extreme = bull ? Math.min(extreme, d[j].low) : Math.max(extreme, d[j].high);
      let stop = bull ? Math.min(extreme, zone.lower) - SMC.stopBufAtr * A : Math.max(extreme, zone.upper) + SMC.stopBufAtr * A;
      stop = bull ? Math.min(stop, mid - SMC.minStopAtr * A) : Math.max(stop, mid + SMC.minStopAtr * A);
      const risk = Math.abs(mid - stop), beyond = (p: number) => (bull ? p > Math.max(mid, bl.price) : p < Math.min(mid, bl.price)); // targets lie beyond the level the shift broke
      const liq = (upTo: number) => { // untouched swing extremes (confirmed by candle upTo) that nothing has traded through up to that candle
        const o: number[] = [];
        for (const x of sw) {
          if (x.type !== (bull ? 'high' : 'low') || x.i + SMC.right > upTo || !beyond(x.price)) continue;
          if (d.slice(x.i + 1, upTo + 1).every(k => (bull ? k.high <= x.price : k.low >= x.price))) o.push(+x.price.toFixed(6));
        }
        return [...new Set(o)].sort((p, q) => (bull ? p - q : q - p));
      };
      const targets = liq(L).slice(0, 2); if (!targets.length && beyond(bull ? rHigh : rLow)) targets.push(bull ? rHigh : rLow);
      const t0 = liq(m)[0], rr = targets.length && risk > 0 ? Math.abs(targets[0] - mid) / risk : null, after = d.slice(m + 1); // t0: the first target as it stood when the shift happened
      const stopped = after.some(x => (bull ? x.low <= stop : x.high >= stop)), hit = t0 !== undefined && after.some(x => (bull ? x.high > t0 : x.low < t0));
      const early = d.slice(m + 1, L).some(x => (bull ? x.low <= zone.upper : x.high >= zone.lower)), touchedNow = bull ? last.low <= zone.upper : last.high >= zone.lower, filledNow = bull ? last.low <= mid : last.high >= mid, age = L - m;
      const status: SmcStatus = stopped ? 'invalidated' : hit ? 'target_passed' : age > SMC.maxAge ? 'stale' : early ? 'mitigated' : filledNow ? 'entry_passed' : touchedNow ? 'in_zone' : 'waiting';
      const pdOk = bull ? mid <= eq : mid >= eq, rrOk = rr !== null && rr >= SMC.minRR, fresh = status === 'waiting' || status === 'in_zone', htfOk = htf === undefined ? null : htf === dir;
      const checks = [
        { key: 'sweep', label: bull ? 'Sell-side liquidity swept (wick below a swing low, close back above)' : 'Buy-side liquidity swept (wick above a swing high, close back below)', ok: true as boolean | null },
        { key: 'mss', label: `Market structure shift with displacement (${disp === 'fvg' ? 'left a fair value gap' : 'strong candle body'})`, ok: true },
        { key: 'zone', label: `Entry zone found: ${zone.kind}`, ok: true },
        { key: 'pd', label: bull ? 'Entry sits in the discount half of the range' : 'Entry sits in the premium half of the range', ok: pdOk },
        { key: 'rr', label: `Estimated R:R is at least ${SMC.minRR}`, ok: rrOk },
        { key: 'fresh', label: 'Entry zone untouched since the shift, and the entry not yet reached', ok: fresh },
        { key: 'htf', label: 'Higher-timeframe structure agrees', ok: htfOk },
      ];
      cands.push({ m, direction: dir, sweep: { time: d[s].time, level: sp.level, extreme }, mss: { time: d[m].time, level: bl.price, displacement: disp }, entryZone: zone, entryMid: mid, invalidation: stop, risk, targets, estimatedRR: rr,
        range: { low: rLow, high: rHigh, eq }, status, distance: bull ? last.close - zone.upper : zone.lower - last.close, ageCandles: age, atr: A, checks, ok: pdOk && rrOk && fresh, htfAligned: htfOk });
    }
  }
  cands.sort((p, q) => q.m - p.m);
  const pick = cands.find(x => x.ok) ?? cands.find(x => x.status === 'waiting' || x.status === 'in_zone') ?? cands[0] ?? null;
  return { d, L, A, sw, setup: pick ? (({ m, ...rest }) => rest)(pick) as SmcSetup : null, sweepsSeen: sweepsSeen.sort((p, q) => q.s - p.s) };
}
/** The best current SMC setup (complete sequence), or null. `htf` = higher-timeframe structure ('bullish' | 'bearish' | ...). */
export const smcSetup = (c: Candle[], htf?: string): SmcSetup | null => smcCore(c, htf)?.setup ?? null;
/** SMC read for display: dealing range with premium/discount, the best setup, and (when there is none) a half-formed sweep waiting for its shift. */
export function smcRead(c: Candle[], htf?: string) {
  const k = smcCore(c, htf); if (!k) return null;
  const hi = [...k.sw].reverse().find(x => x.type === 'high'), lo = [...k.sw].reverse().find(x => x.type === 'low'), price = k.d[k.L].close;
  const range = hi && lo && hi.price > lo.price ? { high: hi.price, low: lo.price, eq: (hi.price + lo.price) / 2, pct: (price - lo.price) / (hi.price - lo.price) } : null;
  const zone = range ? (range.pct < 0.45 ? 'discount' : range.pct > 0.55 ? 'premium' : 'equilibrium') : null;
  const sp = k.setup ? null : k.sweepsSeen.find(x => x.s >= k.L - 15);
  const partial = sp ? { stage: 'sweep', direction: sp.dir, level: sp.level, ageCandles: k.L - sp.s,
    text: sp.dir === 'bullish' ? `Sell-side liquidity was swept below ${sp.level}. A bullish structure shift with displacement is still needed before there is a setup.` : `Buy-side liquidity was swept above ${sp.level}. A bearish structure shift with displacement is still needed before there is a setup.` } : null;
  return { htf: htf ?? null, atr: k.A, price, range, zone, setup: k.setup, partial };
}
