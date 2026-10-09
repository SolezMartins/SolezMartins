import WebSocket from 'ws';
import type { Candle } from '@dmi/types';
import { child } from './log.js';
const log = child('deriv'), sleep = (ms: number) => new Promise(r => setTimeout(r, ms)), MIN_GAP = Number(process.env.DERIV_MIN_INTERVAL_MS) || 125;
/** Endpoint candidates, tried in rotation when a connection fails. Override with DERIV_WS_URLS (comma separated; {app_id} is substituted). */
const ENDPOINTS = (process.env.DERIV_WS_URLS ?? 'wss://api.derivws.com/trading/v1/options/ws/public,wss://ws.derivws.com/websockets/v3?app_id={app_id}').split(',').map(x => x.trim()).filter(Boolean);
const RETRYABLE = new Set(['RateLimit', 'ServiceUnavailable']);
/** Public Deriv market-data client (no auth, no trading calls): request throttling, retry with backoff, reconnect with backoff, subscription recovery. */
export class DerivClient {
  private ws!: WebSocket; private id = 1; private pending = new Map<number, { resolve: (m: any) => void; reject: (e: Error) => void }>();
  lastMessageAt = 0; private opened = false; onReconnect?: () => void; private tries = 0;
  private subs = new Map<string, Set<(t: any) => void>>(); private subIds = new Map<string, string>();
  private ep = 0; private lastSend = 0; private gate: Promise<void> = Promise.resolve();
  constructor(private appId = process.env.DERIV_APP_ID || '1089') { this.connect(); }
  private connect() {
    const url = ENDPOINTS[this.ep % ENDPOINTS.length].replace('{app_id}', this.appId); let up = false;
    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      up = true; log.info({ reconnect: this.opened, endpoint: url.split('?')[0] }, 'connected'); this.tries = 0; if (this.opened) this.onReconnect?.(); this.opened = true;
      for (const symbol of this.subs.keys()) { this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 })); log.info({ symbol }, 'resubscribed'); }
    });
    this.ws.on('message', d => { try { this.dispatch(JSON.parse(d.toString())); } catch (err) { log.error({ err }, 'message handling failed'); } });
    this.ws.on('close', () => {
      if (!up) { this.ep++; log.warn({ next: ENDPOINTS[this.ep % ENDPOINTS.length].split('?')[0] }, 'endpoint failed, rotating'); }
      const wait = Math.min(30_000, 1000 * 2 ** this.tries++) * (0.7 + Math.random() * 0.6); log.warn({ retryInMs: Math.round(wait) }, 'disconnected');
      for (const p of this.pending.values()) p.reject(new Error('connection closed')); this.pending.clear(); this.subIds.clear(); // server-side subscriptions die with the connection
      setTimeout(() => this.connect(), wait);
    });
    this.ws.on('error', (err: Error) => { log.warn({ err: err.message }, 'socket error'); this.ws.close(); });
  }
  private dispatch(m: any) {
    this.lastMessageAt = Date.now();
    if (m.msg_type === 'tick' && m.tick) {
      if (m.subscription?.id) this.subIds.set(m.tick.symbol, m.subscription.id);
      for (const cb of this.subs.get(m.tick.symbol) ?? []) { try { cb(m.tick); } catch (err) { log.error({ err, symbol: m.tick.symbol }, 'tick handler failed'); } } // one bad handler never stops the feed
    }
    const p = this.pending.get(m.req_id); if (p) { this.pending.delete(m.req_id); p.resolve(m); }
  }
  private async once(req: object, timeout: number): Promise<any> {
    for (let i = 0; this.ws.readyState !== WebSocket.OPEN; i++) { if (i > 75) throw new Error('Deriv not connected'); await sleep(200); }
    const turn = this.gate.then(async () => { const d = this.lastSend + MIN_GAP - Date.now(); if (d > 0) await sleep(d); this.lastSend = Date.now(); }); // throttle
    this.gate = turn.catch(() => {}); await turn;
    return new Promise((resolve, reject) => {
      const req_id = this.id++, t = setTimeout(() => { this.pending.delete(req_id); reject(new Error('Deriv request timed out')); }, timeout);
      this.pending.set(req_id, { resolve: m => { clearTimeout(t); resolve(m); }, reject: e => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ ...req, req_id }));
    });
  }
  /** Retries timeouts, dropped connections and rate-limit/service errors up to 3 times with exponential backoff + jitter. */
  async request(req: object, timeout = 10_000): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      try {
        const m = await this.once(req, timeout);
        if (m.error && RETRYABLE.has(m.error.code) && attempt < 3) throw new Error(m.error.message ?? m.error.code);
        return m;
      } catch (e: any) {
        if (attempt >= 3) throw e;
        const wait = 500 * 2 ** attempt * (0.7 + Math.random() * 0.6); log.warn({ attempt: attempt + 1, retryInMs: Math.round(wait), reason: e.message }, 'deriv request retry'); await sleep(wait);
      }
    }
  }
  /** Dynamic discovery: nothing hard-coded. */
  lastInfo: any = null; // what the last market-list request returned (shown on /api/status for troubleshooting)
  async instruments() {
    let m = await this.request({ active_symbols: 'brief', product_type: 'basic' });
    if (m.error) m = await this.request({ active_symbols: 'brief' }); // some endpoints reject product_type
    if (m.error) { this.lastInfo = { error: `${m.error.code}: ${m.error.message}` }; throw new Error(m.error.message ?? m.error.code); }
    // The new Deriv API renamed fields: symbol -> underlying_symbol, display_name -> underlying_symbol_name, pip -> pip_size. Accept both.
    const all: any[] = (m.active_symbols ?? []).map((s: any) => ({ ...s, symbol: s.underlying_symbol ?? s.symbol, display_name: s.underlying_symbol_name ?? s.display_name, pip: s.pip_size ?? s.pip })).filter((s: any) => typeof s.symbol === 'string' && s.symbol), counts: Record<string, number> = {};
    for (const s of all) { const k = `${s.market}/${s.submarket}`; counts[k] = (counts[k] ?? 0) + 1; }
    this.lastInfo = { total: all.length, markets: counts, sample: all.slice(0, 3).map(s => s.symbol) };
    const SYN_SYMBOL = /^(R_\d+|1HZ\d+V|BOOM\d+N?|CRASH\d+N?|JD\d+|stpRNG\d*|RDBEAR|RDBULL|WLD\w+|DRIFT\w*|RB\d+)$/i, SYN_NAME = /volatil|boom|crash|jump|step index|drift|range break/i;
    let pick = all.filter(s => ['synthetic_index', 'derived', 'synthetics'].includes(s.market) || SYN_SYMBOL.test(s.symbol) || SYN_NAME.test(s.display_name ?? ''));
    if (!pick.length) pick = all; // never return an empty list silently
    return pick.map((s: any) => ({ symbol: s.symbol, name: s.display_name ?? s.symbol, market: s.market, submarket: s.submarket, pip: s.pip, open: s.exchange_is_open === undefined ? true : !!s.exchange_is_open }));
  }
  async candles(symbol: string, granularity: number, count = 500, end: string | number = 'latest'): Promise<Candle[]> {
    const m = await this.request({ ticks_history: symbol, style: 'candles', granularity, count, end });
    if (m.error) throw new Error(m.error.message);
    return m.candles.map((c: any) => ({ time: c.epoch, open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
  }
  /** Live tick subscription (re-established automatically after reconnect). */
  subscribe(symbol: string, cb: (t: any) => void) {
    const first = !this.subs.has(symbol); if (first) this.subs.set(symbol, new Set()); this.subs.get(symbol)!.add(cb);
    if (first) { log.info({ symbol }, 'subscribe'); this.request({ ticks: symbol, subscribe: 1 }).catch(err => log.error({ err: err.message, symbol }, 'subscribe failed')); }
  }
  /** Stop a tick stream nobody needs (frees Deriv-side subscription and our handlers). */
  unsubscribe(symbol: string) {
    this.subs.delete(symbol); const id = this.subIds.get(symbol); this.subIds.delete(symbol); log.info({ symbol }, 'unsubscribe');
    if (id) this.request({ forget: id }).catch(err => log.warn({ err: err.message, symbol }, 'forget failed'));
  }
}
