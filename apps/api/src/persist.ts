import type { Candle } from '@dmi/types';
import { SB, SVC, supabaseEnabled } from './auth.js';
import type { DerivClient } from './deriv.js';
import { categorize, slugify } from './categories.js';
import { child } from './log.js';
const log = child('persist');
/** Batched, best-effort market-data persistence (service role). Failures never affect live analysis. */
const PERSIST_TICKS = process.env.PERSIST_TICKS === 'true';
const MAX_QUEUE = 50_000, HOUR = 3_600_000;
const num = (k: string, d: number) => Number(process.env[k]) || d;
const candleQ = new Map<string, any>(); // keyed by symbol|tf|ts so repeats/backfills dedupe
const tickQ: any[] = [];
const iso = (e: number) => new Date(e * 1000).toISOString();

async function post(path: string, body: unknown, prefer: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method: 'POST', body: JSON.stringify(body),
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: prefer } });
  if (!r.ok) throw new Error(`persist ${path.split('?')[0]} ${r.status}`);
}
async function flush() {
  for (const [rows, path, prefer] of [[[...candleQ.values()], 'candles?on_conflict=symbol,timeframe,ts', 'resolution=merge-duplicates,return=minimal'], [tickQ, 'ticks', 'return=minimal']] as const) {
    for (let i = 0; i < rows.length; i += 500) {
      try { await post(path, rows.slice(i, i + 500), prefer); } catch (e) { log.error({ err: String(e) }, 'persist failed'); return; } // keep queued, retry next tick
      if (rows === tickQ) tickQ.splice(0, 500); else rows.slice(i, i + 500).forEach(r => candleQ.delete(`${r.symbol}|${r.timeframe}|${r.ts}`));
      if (rows === tickQ) i -= 500;
    }
  }
}
export const persist = {
  enabled: supabaseEnabled,
  candles(symbol: string, timeframe: string, cs: Candle[]) {
    if (!supabaseEnabled) return;
    for (const c of cs) { const ts = iso(c.time); candleQ.set(`${symbol}|${timeframe}|${ts}`, { symbol, timeframe, ts, open: c.open, high: c.high, low: c.low, close: c.close }); }
    while (candleQ.size > MAX_QUEUE) candleQ.delete(candleQ.keys().next().value!);
  },
  tick(symbol: string, epoch: number, quote: number) {
    if (!supabaseEnabled || !PERSIST_TICKS) return;
    tickQ.push({ symbol, ts: iso(epoch), quote }); if (tickQ.length > MAX_QUEUE) tickQ.splice(0, tickQ.length - MAX_QUEUE);
  },
  start(deriv: DerivClient) {
    if (!supabaseEnabled) return log.info('Supabase not configured: market data is not stored');
    const guard = (f: () => Promise<void>) => () => f().catch(e => log.error({ err: String(e) }, 'persist failed'));
    const sync = guard(async () => { const list = (await deriv.instruments()) as any[];
      await post('instruments?on_conflict=symbol', list.map(i => ({ symbol: i.symbol, display_name: i.name, market: i.market, submarket: i.submarket, pip: i.pip, is_open: i.open, category: categorize(i.name, i.submarket), slug: slugify(i.name), updated_at: new Date().toISOString() })), 'resolution=merge-duplicates,return=minimal');
      const now = new Date().toISOString(), cats = [...new Set(list.map(i => categorize(i.name, i.submarket)))];
      await post('market_categories?on_conflict=id', cats.map(c => ({ id: c, name: c, updated_at: now })), 'resolution=merge-duplicates,return=minimal');
      await post('market_data_sources?on_conflict=id', [{ id: 'deriv', name: 'Deriv public WebSocket', kind: 'websocket', status: list.length ? 'active' : 'degraded', last_seen: now, updated_at: now }], 'resolution=merge-duplicates,return=minimal'); });
    const prune = guard(async () => { await post('rpc/prune_market_data', { tick_hours: num('RETENTION_TICK_HOURS', 24), short_days: num('RETENTION_SHORT_DAYS', 30), mid_days: num('RETENTION_MID_DAYS', 180), long_days: num('RETENTION_LONG_DAYS', 730) }, 'return=minimal');
      await post('rpc/prune_analysis_data', { series_days: num('RETENTION_ANALYSIS_SERIES_DAYS', 90), event_days: num('RETENTION_ANALYSIS_EVENT_DAYS', 365) }, 'return=minimal'); });
    setInterval(guard(flush), 10_000); setInterval(sync, 6 * HOUR); setInterval(prune, 6 * HOUR); sync(); prune();
  },
};

/** Read stored candles (ascending) ending at `to`. Returns [] when persistence is off or the query fails. */
export async function readCandles(symbol: string, tf: string, to: number, limit: number): Promise<Candle[]> {
  if (!supabaseEnabled) return [];
  const q = `candles?select=ts,open,high,low,close&symbol=eq.${encodeURIComponent(symbol)}&timeframe=eq.${tf}&ts=lte.${encodeURIComponent(iso(to))}&order=ts.desc&limit=${limit}`;
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: SVC!, Authorization: `Bearer ${SVC}` } }).catch(() => null);
  if (!r?.ok) return [];
  return ((await r.json()) as any[]).reverse().map(x => ({ time: Math.floor(Date.parse(x.ts) / 1000), open: +x.open, high: +x.high, low: +x.low, close: +x.close }));
}
