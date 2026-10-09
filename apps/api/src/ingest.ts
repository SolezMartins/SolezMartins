import type { Candle } from '@dmi/types';
import { analyze, closedCandle, scenario, entryStatusAt, isChasing, SIGNAL_RULES, smcSetup, htfStructure, type SmcSetup } from '@dmi/strategies';
import type { DerivClient } from './deriv.js';
import { TF } from './scanner.js';
import { store } from './store.js';
import { trackStep, toTracked } from './tracker.js';
import { persist } from './persist.js';
import { record } from './analysisStore.js';
import type { Bus } from './bus.js';
import { child } from './log.js';
import { SCN_KIND, SCN_TEXT, scnHit } from './scenarioAlerts.js';
const log = child('ingest');
const isSmc = (t: any) => typeof t?.strategy === 'string' && t.strategy.includes('SMC'); // SMC and confluence signals are tracked separately

class CandleBuilder {
  constructor(private tf: number, public cur: Candle) {}
  update(epoch: number, price: number) {
    const t = Math.floor(epoch / this.tf) * this.tf;
    if (this.cur.time < t) { const closed = this.cur; this.cur = { time: t, open: price, high: price, low: price, close: price }; return { closed }; }
    this.cur.high = Math.max(this.cur.high, price); this.cur.low = Math.min(this.cur.low, price); this.cur.close = price;
    return { closed: null };
  }
}
/** What happened on a just-closed candle (new events only, not standing conditions). */
type Closed = { events: { kind: string; dir: string }[]; rsi: [number, number]; score: number; prevScore?: number; scn?: any; htf?: string; close?: number; smc?: SmcSetup | null };
const inside = (p: number, z: any) => p >= z.lower && p <= z.upper;

/** Deriv ticks -> candle builder -> analysis on candle close -> alerts. Talks to the API only through the bus. */
export class Ingest {
  private hist = new Map<string, Candle[]>(); private builders = new Map<string, CandleBuilder>(); private loading = new Map<string, Promise<void>>();
  private ticking = new Set<string>(); private alerts: any[] = []; private touched = new Map<string, number>();
  private tracked: any[] = []; private inflight = new Set<string>(); private warnedTracking = false; private signalled = new Set<string>(); private lastPrice = new Map<string, number>(); private zones = new Map<string, any[]>(); private lastScore = new Map<string, number>(); private scn = new Map<string, any>(); private scnState = new Map<string, string | null>();
  constructor(private deriv: DerivClient, private bus: Bus) {
    this.refresh(); setInterval(() => this.refresh(), 10_000); setInterval(() => this.sweep(), 60_000); deriv.onReconnect = () => this.recover();
    bus.subscribe('watch', m => { if (typeof m?.symbol === 'string' && m.symbol.length < 40 && TF[m.tf]) this.watch(m.symbol, m.tf).catch(err => log.warn({ err: err.message, symbol: m.symbol }, 'watch failed')); });
    bus.subscribe('alerts', () => this.refresh());
    setInterval(() => bus.publish('heartbeat', { at: deriv.lastMessageAt }), 5000);
  }
  /** Reload active alerts (all users) and make sure their symbols are streaming. */
  async refresh() {
    this.alerts = await store.activeAlerts().catch(() => this.alerts);
    for (const a of this.alerts) this.watch(a.symbol, a.tf || '1m').catch(err => log.warn({ err: err.message, symbol: a.symbol }, 'watch failed'));
    await this.refreshTracked();
  }
  /** Signal journal entries being tracked (pending/filled) plus recent ones for duplicate checks. Entries whose update is still being saved keep their local state. */
  private async refreshTracked() {
    try {
      const rows: any[] = await store.trackedSignals(Date.now() - 24 * 3600_000), local = new Map(this.tracked.map(t => [t.id, t]));
      this.tracked = rows.map(r => (this.inflight.has(r.id) && local.has(r.id) ? local.get(r.id) : r));
      for (const t of this.tracked) if (['pending', 'filled'].includes(t.entryStatus) && t.result === 'open' && t.tf) this.watch(t.symbol, t.tf).catch(err => log.warn({ err: err.message, symbol: t.symbol }, 'watch failed')); // keep the stream alive while a signal is open
    } catch (err: any) { if (!this.warnedTracking) { this.warnedTracking = true; log.warn({ err: err.message }, 'outcome tracking unavailable (run supabase migration 0009)'); } }
  }
  /** Feed one live price to every open signal entry on this market. */
  private track(sym: string, price: number, epoch: number) {
    for (const e of this.tracked) {
      if (e.symbol !== sym || this.inflight.has(e.id)) continue;
      const t = toTracked(e, tf => TF[tf]); if (!t) continue;
      const patch = trackStep(t, price, epoch); if (!patch) continue;
      const { event, why, ...fields } = patch; Object.assign(e, fields, event === 'filled' ? {} : { result: patch.result ?? e.result });
      this.inflight.add(e.id);
      store.updateFor(e.id, { ...fields, ...(patch.result ? { result: patch.result } : {}) }).catch(err => log.error({ err: err.message, id: e.id }, 'signal outcome not saved')).finally(() => this.inflight.delete(e.id));
      const r = (x: any) => (typeof x === 'number' ? +x.toFixed(2) : x), text = event === 'filled' ? `${sym} signal entry filled @ ${r(price)}` : event === 'missed' ? `${sym} signal missed: ${why}` : `${sym} signal ${event.toUpperCase()}: ${r(patch.rMultiple)}R @ ${r(patch.exitPrice)}`;
      log.info({ sym, id: e.id, event }, 'signal outcome');
      this.bus.publish('alert', { userId: e.userId, alert: { kind: 'signal_result', symbol: sym }, price, text });
    }
  }
  /** Baseline state so alerts fire on NEW events/crossings, never on conditions that already existed. */
  private seed(key: string, sym: string, tf: string, closed: Candle[]) {
    try {
      const a = analyze(sym, tf, closed), px = closed[closed.length - 1].close, sc = scenario(a.snapshot, { zones: a.detail.zones, fvgs: a.detail.fvgs }, px, a.detail.indicators.atr);
      this.zones.set(key, a.detail.zones); this.lastScore.set(key, a.snapshot.confluenceScore); this.scn.set(key, sc); this.scnState.set(key, entryStatusAt(sc as any, px)); // baseline: scenario alerts fire on changes, not on standing states
    } catch (err) { log.warn({ err, key }, 'analysis seed failed'); }
  }
  async watch(sym: string, tf: string) {
    const key = `${sym}|${tf}`; this.touched.set(key, Date.now());
    if (!this.hist.has(key)) {
      let p = this.loading.get(key);
      if (!p) {
        p = this.deriv.candles(sym, TF[tf], 500).then(h => { this.hist.set(key, h); this.builders.set(key, new CandleBuilder(TF[tf], h[h.length - 1])); persist.candles(sym, tf, h.slice(0, -1)); this.seed(key, sym, tf, h.slice(0, -1)); }).finally(() => this.loading.delete(key));
        this.loading.set(key, p);
      }
      await p;
    }
    if (!this.ticking.has(sym)) { this.ticking.add(sym); this.deriv.subscribe(sym, t => this.onTick(sym, t)); }
  }
  /** After a Deriv reconnect: refill candles missed while offline (last 500 per stream) and resync the forming candle. */
  async recover() {
    for (const key of [...this.hist.keys()]) {
      const [sym, tf] = key.split('|');
      try { const h = await this.deriv.candles(sym, TF[tf], 500); this.hist.set(key, h); this.builders.set(key, new CandleBuilder(TF[tf], h[h.length - 1])); persist.candles(sym, tf, h.slice(0, -1)); this.seed(key, sym, tf, h.slice(0, -1)); } catch (err) { log.warn({ err, key }, 'recover failed'); }
    }
    this.lastPrice.clear(); // don't treat the price jump across an outage as a "crossing"
  }
  /** Release streams nobody asked for recently (no client watch heartbeat, no active alert): frees memory and the Deriv subscription. */
  sweep(now = Date.now(), idleMs = 180_000) {
    for (const key of [...this.touched.keys()]) {
      const [sym, tf] = key.split('|');
      if (now - this.touched.get(key)! < idleMs || this.alerts.some(a => a.active && a.symbol === sym && (a.tf || '1m') === tf)) continue;
      for (const m of [this.hist, this.builders, this.zones, this.lastScore, this.touched, this.scn, this.scnState] as Map<string, any>[]) m.delete(key);
      log.info({ key }, 'released idle stream');
      if (![...this.builders.keys()].some(k => k.startsWith(sym + '|'))) { this.ticking.delete(sym); this.lastPrice.delete(sym); this.deriv.unsubscribe(sym); }
    }
  }
  private onTick(sym: string, tick: any) {
    const price = +tick.quote, prev = this.lastPrice.get(sym);
    persist.tick(sym, tick.epoch, price);
    try { this.track(sym, price, +tick.epoch); } catch (err) { log.error({ err }, 'signal tracking failed'); }
    for (const [key, b] of this.builders) {
      const [s, tf] = key.split('|'); if (s !== sym) continue;
      try {
        const h = this.hist.get(key)!, { closed } = b.update(tick.epoch, price); let ctx: Closed | null = null;
        if (closed) {
          persist.candles(sym, tf, [closed]); h[h.length - 1] = closed; h.push(b.cur); if (h.length > 600) h.shift();
          const done = h.slice(0, -1), an = analyze(sym, tf, done), cc = closedCandle(done);
          ctx = { events: cc.events, rsi: cc.rsi, score: an.snapshot.confluenceScore, prevScore: this.lastScore.get(key), htf: an.snapshot.htfStructure as string, close: closed.close,
            scn: scenario(an.snapshot, { zones: an.detail.zones, fvgs: an.detail.fvgs }, closed.close, an.detail.indicators.atr),
            smc: this.alerts.some((a: any) => a.active && a.kind === 'smc_signal' && a.symbol === sym && (!a.tf || a.tf === tf)) ? smcSetup(done, htfStructure(done)) : undefined }; // only computed when someone has an SMC alert on this stream
          this.zones.set(key, an.detail.zones); this.lastScore.set(key, ctx.score);
          this.scn.set(key, ctx.scn); this.scnState.set(key, entryStatusAt(ctx.scn as any, price)); // the scenario may have changed with the new candle: re-baseline so only price moves from here fire alerts
          record(sym, tf, TF[tf], done, an, cc); // archive the closed candle's analysis (no-op without Supabase / below the minimum timeframe)
        } else h[h.length - 1] = b.cur;
        this.bus.publish('candle', { symbol: sym, tf, candle: b.cur });
        const sc = this.scn.get(key), now = sc ? entryStatusAt(sc, price) : null;
        this.check(sym, tf, key, price, prev, ctx, sc, now);
        this.scnState.set(key, now);
      } catch (err) { log.error({ err, key }, 'tick processing failed'); } // one failing stream never stops the others
    }
    this.lastPrice.set(sym, price);
  }
  /**
   * Rule-based trade signal (analysis, not advice): on a closed candle, confluence >= the alert's threshold, an unfilled zone/FVG entry exists on the pullback side,
   * the higher-timeframe structure agrees with the direction, and the estimated R:R is at least 1.5. Writes an "open" Journal entry for the alert's owner (once per setup).
   */
  private signal(a: any, sym: string, tf: string, c: Closed) {
    const s = c.scn, min = Number.isFinite(a.level) ? a.level : 70;
    if (!s?.entryZone || !s.targets?.length || !(s.estimatedRR >= SIGNAL_RULES.minRR) || c.score < min || c.htf !== s.direction || !['waiting', 'in_zone'].includes(s.status)) return; // only while the entry is still ahead of / inside the zone
    const mid = s.entryMid, id = `${a.id}|${s.direction}|${s.entryZone.lower}|${s.entryZone.upper}`;
    if (this.signalled.has(id)) return; this.signalled.add(id); if (this.signalled.size > 2000) this.signalled.delete(this.signalled.values().next().value as string);
    const long = s.direction === 'bullish', r = (x: number) => +x.toFixed(5), dir = long ? 'long' : 'short', active = (t: any) => t.result === 'open' && ['pending', 'filled'].includes(t.entryStatus);
    // One live signal per market/timeframe/direction, and never the exact same setup twice within a day (also across restarts).
    if (this.tracked.some(t => t.userId === a.userId && t.symbol === sym && t.tf === tf && t.direction === dir && (active(t) || Math.abs(Number(t.entry) - r(mid)) < 1e-6) && !isSmc(t))) return;
    const entry = {
      source: 'signal', tf, confluence: c.score, entryStatus: 'pending', scenarioStatus: s.status === 'in_zone' ? 'in_zone' : isChasing(s.status, s.distance, s.atr) ? 'do_not_chase' : 'waiting', // scenario state when the signal was created (shown in Performance)
      symbol: sym, direction: long ? 'long' : 'short', entry: r(mid), stop: r(s.invalidation), target: r(s.targets[0]), result: 'open', strategy: `Auto signal: confluence ${c.score}/${min}+ on ${tf}`,
      notes: `LIMIT-STYLE entry at the midpoint of the ${s.entryZone.kind} (${r(s.entryZone.lower)} to ${r(s.entryZone.upper)}); price was ${c.close} at signal (${s.status === 'waiting' ? `${r(s.distance)} points above/below the zone: do not chase, wait for price to reach it` : 'inside the zone'}). Risk ${r(s.risk)} points, estimated R:R ${s.estimatedRR.toFixed(1)}. ${s.confirmation} Analysis only, not financial advice; a high score is not a win probability.`,
    };
    store.addFor(a.userId, 'journal', entry).then(row => { if (row) this.tracked.push(row); log.info({ sym, tf, dir: entry.direction }, 'signal journaled'); }).catch(err => log.error({ err: err.message, alertId: a.id }, 'signal not saved'));
    this.bus.publish('alert', { userId: a.userId, alert: { ...a, kind: 'signal' }, price: c.close });
  }
  /**
   * SMC signal (analysis, not advice): a complete sweep -> structure shift -> order block setup (see smcSetup) whose checks pass: entry in discount (long) or premium (short),
   * R:R >= 1.5, entry zone still untouched; and, unless the alert's level is 0, the higher-timeframe structure agrees. Writes a pending limit-style Journal entry, tracked like any signal.
   */
  private smcSignal(a: any, sym: string, tf: string, c: Closed) {
    const s = c.smc; if (!s || !s.ok || !s.targets.length || (a.level !== 0 && s.htfAligned !== true)) return;
    const long = s.direction === 'bullish', dir = long ? 'long' : 'short', r = (x: number) => +x.toFixed(5), mid = s.entryMid, active = (t: any) => t.result === 'open' && ['pending', 'filled'].includes(t.entryStatus);
    if (this.tracked.some(t => t.userId === a.userId && t.symbol === sym && t.tf === tf && t.direction === dir && isSmc(t) && (active(t) || Math.abs(Number(t.entry) - r(mid)) < 1e-6))) return;
    const id = `${a.id}|smc|${s.direction}|${r(mid)}`; if (this.signalled.has(id)) return; this.signalled.add(id); if (this.signalled.size > 2000) this.signalled.delete(this.signalled.values().next().value as string);
    const entry = {
      source: 'signal', tf, entryStatus: 'pending', scenarioStatus: s.status === 'in_zone' ? 'in_zone' : isChasing(s.status, s.distance, s.atr) ? 'do_not_chase' : 'waiting', symbol: sym, direction: dir, entry: r(mid), stop: r(s.invalidation), target: r(s.targets[0]), result: 'open', strategy: `Auto signal: SMC model (sweep, structure shift, ${s.entryZone.kind}) on ${tf}`,
      notes: `SMC ${s.direction}: ${long ? 'sell' : 'buy'}-side liquidity swept at ${r(s.sweep.level)} (extreme ${r(s.sweep.extreme)}), then a structure shift ${long ? 'above' : 'below'} ${r(s.mss.level)} with ${s.mss.displacement === 'fvg' ? 'a fair value gap' : 'a strong candle'}. LIMIT-STYLE entry at the midpoint of the ${s.entryZone.kind} (${r(s.entryZone.lower)} to ${r(s.entryZone.upper)}), in the ${long ? 'discount' : 'premium'} half of the range (equilibrium ${r(s.range.eq)}). Stop beyond the sweep extreme, risk ${r(s.risk)} points; target ${r(s.targets[0])} (next untouched ${long ? 'high' : 'low'}); estimated R:R ${s.estimatedRR!.toFixed(1)}. Higher timeframe ${s.htfAligned ? 'agrees' : 'does not agree (not required by this alert)'}. Price was ${c.close} at signal (${s.status === 'waiting' ? `${r(s.distance)} points from the zone: do not chase, wait for price to reach it` : 'touching the zone'}). Analysis only, not financial advice; an SMC setup is a pattern, not a win probability.`,
    };
    store.addFor(a.userId, 'journal', entry).then(row => { if (row) this.tracked.push(row); log.info({ sym, tf, dir, model: 'smc' }, 'signal journaled'); }).catch(err => log.error({ err: err.message, alertId: a.id }, 'signal not saved'));
    this.bus.publish('alert', { userId: a.userId, alert: { ...a, kind: 'smc_signal' }, price: c.close });
  }
  private check(sym: string, tf: string, key: string, price: number, prev: number | undefined, c: Closed | null, sc?: any, now?: string | null) {
    for (const a of this.alerts.filter((a: any) => a.active && a.symbol === sym && (!a.tf || a.tf === tf))) {
      const dirOk = (d: string) => !a.dir || a.dir === d, has = (p: string) => !!c?.events.some(e => e.kind.startsWith(p) && dirOk(e.dir));
      let hit = false;
      if (a.kind === 'price_level') hit = prev !== undefined && (a.dir === 'below' ? prev > a.level && price <= a.level : prev < a.level && price >= a.level); // crossing, not "is beyond"
      else if (['enter_demand', 'enter_supply', 'zone_enter'].includes(a.kind)) { // entering from outside
        const want = a.kind === 'enter_demand' ? 'demand' : a.kind === 'enter_supply' ? 'supply' : null;
        hit = prev !== undefined && !!this.zones.get(key)?.some(z => (!want || z.dir === want) && inside(price, z) && !inside(prev, z));
      } else if (SCN_KIND[a.kind]) { // live: the status of the market's current scenario changed to the one this alert waits for
        const before = this.scnState.get(key);
        hit = !!sc && scnHit(a.kind, before, now, a.dir, sc.direction);
      } else if (c) {
        if (a.kind === 'bos') hit = has('BOS'); else if (a.kind === 'choch') hit = has('CHOCH'); else if (a.kind === 'sweep') hit = has('SWEEP');
        else if (a.kind === 'fvg') hit = !!c.events.some(e => e.kind.startsWith('FVG_') && e.kind !== 'FVG_FILLED' && dirOk(e.dir)); // a gap created on this candle
        else if (a.kind === 'fvg_filled') hit = c.events.some(e => e.kind === 'FVG_FILLED');
        else if (a.kind === 'ema_cross') hit = has('EMA_CROSS');
        else if (a.kind === 'rsi') { const [p, r] = c.rsi; hit = Number.isFinite(p) && Number.isFinite(r) && (a.dir === 'below' ? p > a.level && r <= a.level : p < a.level && r >= a.level); }
        else if (a.kind === 'confluence') hit = c.prevScore !== undefined && c.prevScore < a.level && c.score >= a.level;
        else if (a.kind === 'signal') this.signal(a, sym, tf, c); // stays armed: never one-shot
        else if (a.kind === 'smc_signal') this.smcSignal(a, sym, tf, c);
      }
      if (hit) { this.alerts = this.alerts.filter(x => x.id !== a.id); store.fire(a.id).catch(err => log.error({ err: err.message, alertId: a.id }, 'alert state not saved')); this.bus.publish('alert', { userId: a.userId, alert: a, price, ...(SCN_KIND[a.kind] ? { text: `${sym} ${tf} ${sc.direction} scenario: ${SCN_TEXT[now as string]} @ ${+price.toFixed(2)}` } : {}) }); }
    }
  }
}
