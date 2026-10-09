import './runtime.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { log } from './log.js';
import { audit } from './audit.js';
import rateLimit from '@fastify/rate-limit';
import { analyze, alignment, historyEvents, scenario, scenarioBacktest, smcRead, htfStructure } from '@dmi/strategies';
import { computePerformance } from './performance.js';
import { categorize, slugify } from './categories.js';
import { scan, TF as TFS } from './scanner.js';
import { GeminiProvider, AIUnavailableError } from '@dmi/ai';
import websocket from '@fastify/websocket';
import { DerivClient } from './deriv.js';
import { Hub } from './live.js';
import { Ingest } from './ingest.js';
import { bus } from './bus.js';
import { ROLE, distributed } from './runtime.js';
import { backtestJob } from './jobs.js';
import { store, KINDS, type Coll } from './store.js';
import { authenticate } from './auth.js';
import { persist, readCandles } from './persist.js';
import { shots, decodeImage, newPath } from './shots.js';
import { readSetups } from './analysisStore.js';

const TF = TFS;
const app = Fastify({ loggerInstance: log, trustProxy: process.env.TRUST_PROXY === 'true' }); // TRUST_PROXY=true behind a reverse proxy so rate limits and audit use the real client IP
// The web client used to send Content-Type: application/json on body-less requests (DELETE, empty PATCH), which Fastify rejects with 400. Treat an empty JSON body as no body.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => { const t = String(body ?? '').trim(); if (!t) return done(null, undefined); try { done(null, JSON.parse(t)); } catch { const e: any = new Error('invalid JSON body'); e.statusCode = 400; done(e, undefined); } });
await app.register(helmet);
await app.register(cors, { origin: process.env.WEB_ORIGIN || 'http://localhost:5173' });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
await app.register(websocket);
const deriv = new DerivClient(), ai = new GeminiProvider(), hub = new Hub(bus);
if (ROLE !== 'api') { new Ingest(deriv, bus); persist.start(deriv); } // ROLE=api leaves streaming to the market-data worker
const ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';
app.addHook('onResponse', async (req, reply) => { // audit trail: mutations, rejected auth, rate limiting (no bodies, no tokens)
  const url = String(req.routeOptions?.url ?? req.url).split('?')[0], s = reply.statusCode, mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!url.startsWith('/api/')) return;
  if (s === 401 || s === 429 || (mutating && s < 400)) audit({ userId: (req as any).auth?.userId, action: s === 401 ? 'auth.rejected' : s === 429 ? 'rate_limited' : `${req.method} ${url}`, resource: (req.params as any)?.id, status: s, ip: req.ip });
});
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/') || req.url.startsWith('/api/status')) return;
  const u = await authenticate(req.headers.authorization?.replace('Bearer ', ''));
  if (!u) return reply.code(401).send({ error: 'unauthorized' });
  (req as any).auth = u;
});
app.get<{ Querystring: { token?: string } }>('/ws', { websocket: true }, (socket, req) => {
  if (req.headers.origin && req.headers.origin !== ORIGIN) { audit({ action: 'ws.rejected_origin', ip: req.ip }); return socket.close(); }
  hub.attach(socket, authenticate(req.query.token).then(u => { if (!u) audit({ action: 'ws.auth_failed', ip: req.ip }); return u?.userId ?? null; }));
});

const str = (n: number) => (v: any) => typeof v === 'string' && v.length <= n;
const T: Record<string, (v: any) => boolean> = {
  symbol: v => typeof v === 'string' && v.length > 0 && v.length < 40, name: v => typeof v === 'string' && v.length > 0 && v.length < 80,
  symbols: v => Array.isArray(v) && v.length <= 200 && v.every(x => typeof x === 'string' && x.length < 40), isDefault: v => typeof v === 'boolean',
  direction: v => ['long', 'short'].includes(v), result: v => ['open', 'win', 'loss', 'breakeven', 'expired', 'missed'].includes(v),
  source: () => false, confluence: () => false, entryStatus: () => false, filledAt: () => false, closedAt: () => false, exitPrice: () => false, rMultiple: () => false, scenarioStatus: () => false, // set only by the signal engine
  entry: Number.isFinite, stop: Number.isFinite, target: Number.isFinite, strategy: str(200), notes: str(2000), lessons: str(2000),
  screenshot: () => false, // set only by the upload route, never by clients
  active: v => typeof v === 'boolean', swingLeft: v => Number.isInteger(v) && v >= 2 && v <= 6, swingRight: v => Number.isInteger(v) && v >= 2 && v <= 6, defaultTf: v => !!TF[v], defaultSymbol: v => typeof v === 'string' && v.length < 40, notifications: v => typeof v === 'boolean',
  level: Number.isFinite, dir: v => ['above', 'below', 'bullish', 'bearish'].includes(v), kind: v => KINDS.includes(v), tf: v => !!TF[v],
};
const fieldsOk = (b: any) => !!b && typeof b === 'object' && Object.entries(b).every(([k, v]) => !(k in T) || T[k](v));
const alertOk = (b: any) => b.kind === 'price_level' ? Number.isFinite(b.level) && ['above', 'below'].includes(b.dir)
  : b.kind === 'rsi' ? Number.isFinite(b.level) && b.level >= 0 && b.level <= 100 && ['above', 'below'].includes(b.dir)
  : b.kind === 'confluence' || b.kind === 'signal' ? Number.isFinite(b.level) && b.level >= 1 && b.level <= 100
  : b.kind === 'smc_signal' ? b.level === 0 || b.level === 1 // 1 = require higher-timeframe agreement, 0 = don't
  : b.dir === undefined || ['bullish', 'bearish'].includes(b.dir);
const valid = (c: Coll, b: any) => fieldsOk(b) && (c === 'watchlists' ? typeof b.name === 'string' && b.name.length < 80
  : c === 'alerts' ? typeof b.symbol === 'string' && KINDS.includes(b.kind) && (b.kind === 'price_level' ? !b.tf || !!TF[b.tf] : !!TF[b.tf]) && alertOk(b)
  : typeof b.symbol === 'string');
const who = (req: any) => req.auth;
// ---- per-user preferences (swing sensitivity applies to analysis, history, scanner, overview, MTF and chat; alerts and backtests use the default 3/3) ----
const PREF_DEFAULTS = { swingLeft: 3, swingRight: 3, defaultTf: '15m', defaultSymbol: '', notifications: true }, prefCache = new Map<string, { at: number; p: typeof PREF_DEFAULTS }>();
const prefsFor = async (req: any) => {
  const u = who(req).userId, hit = prefCache.get(u); if (hit && Date.now() - hit.at < 30_000) return hit.p;
  const row = (await store.list(who(req), 'preferences').catch(() => []))[0], p = { ...PREF_DEFAULTS, ...Object.fromEntries(Object.keys(PREF_DEFAULTS).filter(k => row?.[k] != null).map(k => [k, row[k]])) } as typeof PREF_DEFAULTS;
  prefCache.set(u, { at: Date.now(), p }); return p;
};
const swing = async (req: any) => { const p = await prefsFor(req); return { left: p.swingLeft, right: p.swingRight }; };
for (const c of ['watchlists', 'alerts', 'journal'] as Coll[]) {
  app.get(`/api/${c}`, req => store.list(who(req), c));
  app.post<{ Body: any }>(`/api/${c}`, async (req, reply) => {
    if (!valid(c, req.body)) return reply.code(400).send({ error: 'invalid body' });
    const r = await store.add(who(req), c, req.body); if (c === 'alerts') hub.alertsChanged(); return r;
  });
  app.patch<{ Params: { id: string }; Body: any }>(`/api/${c}/:id`, async (req, reply) => { if (!fieldsOk(req.body)) return reply.code(400).send({ error: 'invalid body' }); const r = await store.update(who(req), c, req.params.id, req.body); if (r && c === 'alerts') hub.alertsChanged(); return r ?? reply.code(404).send({ error: 'not found' }); });
  app.delete<{ Params: { id: string } }>(`/api/${c}/:id`, async (req, reply) => {
    if (c === 'journal') { const e = await own(req, req.params.id); if (e?.screenshot) await shots.del(e.screenshot).catch(() => {}); }
    const gone = await store.remove(who(req), c, req.params.id); if (gone && c === 'alerts') hub.alertsChanged();
    return gone ? { ok: true } : reply.code(404).send({ error: 'not found' });
  });
}
app.get('/', async () => ({ name: 'Deriv Market Intelligence API', status: 'ok' }));
app.get('/api/status', async () => {
  const last = ROLE === 'api' ? hub.lastAt : deriv.lastMessageAt, age = Date.now() - last;
  return { feed: last === 0 ? 'DISCONNECTED' : age > 15000 ? 'DATA DELAYED' : 'LIVE', lastUpdateMs: age, ai: ai.available ? 'available' : 'offline', persistence: persist.enabled ? 'on' : 'off', role: ROLE, bus: distributed ? 'redis' : 'memory', instruments: deriv.lastInfo };
});
app.get('/api/instruments', async () => ((await deriv.instruments()) as any[]).map(i => ({ ...i, category: categorize(i.name, i.submarket), slug: slugify(i.name) })));
app.get<{ Params: { symbol: string }; Querystring: { tf?: string } }>('/api/analysis/:symbol', async (req, reply) => {
  const tf = req.query.tf ?? '15m'; if (!TF[tf]) return reply.code(400).send({ error: 'invalid timeframe' });
  const candles = await deriv.candles(req.params.symbol, TF[tf]);
  const a = analyze(req.params.symbol, tf, candles, await swing(req));
  const closedC = candles.slice(0, -1); // SMC works on closed candles only, like the signal alerts
  return { candles, ...a, scenario: scenario(a.snapshot, a.detail, candles[candles.length - 1].close, a.detail.indicators.atr), smc: smcRead(closedC, htfStructure(closedC)) };
});
app.post<{ Body: { symbol: string; tf?: string } }>('/api/ai/analyze', async (req, reply) => {
  const tf = req.body.tf ?? '15m'; if (!TF[tf]) return reply.code(400).send({ error: 'invalid timeframe' });
  const { snapshot } = analyze(req.body.symbol, tf, await deriv.candles(req.body.symbol, TF[tf]));
  try { const explanation = await ai.generateAnalysis(snapshot); store.add(who(req), 'reports', { symbol: req.body.symbol, timeframe: tf, snapshot, explanation }).catch(() => {}); return { snapshot, explanation }; }
  catch (e: any) { req.log.warn({ err: e?.message }, 'ai analyze unavailable'); return { snapshot, explanation: null, notice: e.message }; } // AI failure never breaks the app
});
app.get<{ Querystring: { tf?: string; category?: string; bias?: string; minScore?: string } }>('/api/scanner', async (req, reply) => {
  const tf = req.query.tf ?? '15m'; if (!TF[tf]) return reply.code(400).send({ error: 'invalid timeframe' });
  let rows = await scan(deriv, tf, 3, await swing(req)); const { category, bias, minScore } = req.query;
  if (category) rows = rows.filter(r => r.category === category);
  if (bias) rows = rows.filter(r => r.bias.includes(bias));
  if (minScore) rows = rows.filter(r => r.confluenceScore >= +minScore);
  return { note: 'Research tool. Scores are technical confluence, not win probability.', rows };
});
app.get<{ Params: { symbol: string }; Querystring: { tfs?: string } }>('/api/mtf/:symbol', async (req, reply) => {
  const tfs = (req.query.tfs ?? '4h,1h,15m,5m').split(','); if (tfs.some(t => !TF[t])) return reply.code(400).send({ error: 'invalid timeframe' });
  const snaps = [], sw = await swing(req); for (const t of tfs) snaps.push(analyze(req.params.symbol, t, await deriv.candles(req.params.symbol, TF[t]), sw).snapshot);
  return { alignment: alignment(snaps), snapshots: snaps };
});
/** Stored candles first; older/missing ranges are filled from Deriv (and saved). */
async function loadCandles(sym: string, tf: string, to: number, limit: number) {
  let candles = await readCandles(sym, tf, to, limit);
  if (candles.length && candles[candles.length - 1].time < to - 3 * TF[tf]) candles = []; // stored data doesn't reach this window
  if (candles.length < limit) {
    const more = await deriv.candles(sym, TF[tf], limit - candles.length, candles.length ? candles[0].time - 1 : to);
    const have = new Set(candles.map(c => c.time));
    candles = [...more.filter(c => !have.has(c.time)), ...candles].sort((a, b) => a.time - b.time);
    persist.candles(sym, tf, more.filter(c => c.time + TF[tf] <= Date.now() / 1000));
  }
  return candles;
}
/** Historical view: stored candles first, older/missing ranges filled from Deriv (and saved). Events are replay-safe (no lookahead). */
app.get<{ Params: { symbol: string }; Querystring: { tf?: string; to?: string; limit?: string } }>('/api/history/:symbol', async (req, reply) => {
  const tf = req.query.tf ?? '15m', sym = req.params.symbol; if (!TF[tf]) return reply.code(400).send({ error: 'invalid timeframe' });
  const limit = Math.min(Math.max(+(req.query.limit ?? 500) || 500, 50), 2000), now = Math.floor(Date.now() / 1000), to = Math.min(+(req.query.to ?? now) || now, now);
  try {
    const candles = await loadCandles(sym, tf, to, limit);
    if (candles.length < 20) return reply.code(404).send({ error: 'not enough history' });
    const sw = await swing(req); return { candles, ...historyEvents(candles, sw.left, sw.right) };
  } catch (e: any) { return reply.code(502).send({ error: e.message ?? 'history unavailable' }); }
});
const BT_REQ = ['sweep', 'bos', 'choch', 'fvg', 'zone'];
app.post<{ Body: any }>('/api/backtest', async (req, reply) => {
  const b = req.body ?? {}, r = b.rules ?? {};
  const int = (v: any, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi, num = (v: any, lo: number, hi: number) => typeof v === 'number' && v >= lo && v <= hi;
  if (typeof b.symbol !== 'string' || b.symbol.length > 40 || !TF[b.tf] || !int(b.limit, 200, 5000) || !['long', 'short'].includes(r.direction) || !Array.isArray(r.require) || !r.require.length
    || !r.require.every((k: any) => BT_REQ.includes(k)) || !int(r.window, 1, 100) || !num(r.stopAtr, 0.3, 10) || !num(r.rr, 0.5, 10) || !int(r.maxHold, 1, 500) || ![0, 2, 3, 4, 6, 8, 12, 24].includes(r.htfFactor))
    return reply.code(400).send({ error: 'invalid backtest request' });
  const cs = b.costs ?? {}; // optional cost assumptions: slippage as a fraction of ATR, flat fee in R
  if (b.costs !== undefined && (typeof cs !== 'object' || (cs.slipAtr !== undefined && !num(cs.slipAtr, 0, 2)) || (cs.feeR !== undefined && !num(cs.feeR, 0, 1)))) return reply.code(400).send({ error: 'invalid costs' });
  try {
    const candles = await loadCandles(b.symbol, b.tf, Math.floor(Date.now() / 1000), b.limit);
    if (candles.length < 100) return reply.code(404).send({ error: 'not enough history' });
    const result = await backtestJob(candles, r, TF[b.tf], { slipAtr: cs.slipAtr, feeR: cs.feeR });
    if (b.save !== true) return result;
    // Saved server-side from the engine's own output (never client-supplied); keep the latest 50 per user.
    const rec = await store.add(who(req), 'backtests', { symbol: b.symbol, tf: b.tf, rules: r, result });
    const old = (await store.list(who(req), 'backtests', { cols: 'id,created_at' })).sort((x: any, y: any) => +new Date(y.createdAt) - +new Date(x.createdAt)).slice(50);
    for (const o of old) await store.remove(who(req), 'backtests', o.id).catch(() => {});
    return { ...result, savedId: rec.id };
  } catch (e: any) { return reply.code(502).send({ error: e.message ?? 'backtest unavailable' }); }
});
// ---- Performance report from the user's own journal (auto-tracked signals use measured R, manual entries planned R) ----
app.get('/api/performance', async req => computePerformance((await store.list(who(req), 'journal')) as any[]));
// ---- Evidence: how the exact rule behind "Trade signal" alerts performed on this market's recent candles (CPU heavy: cached, rate limited, yields to the event loop) ----
const evidenceCache = new Map<string, { at: number; p: Promise<any> }>();
app.get<{ Params: { symbol: string }; Querystring: { tf?: string; limit?: string; min?: string; slip?: string; fee?: string; strategy?: string; htf?: string } }>('/api/evidence/:symbol', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
  const sym = req.params.symbol, tf = req.query.tf ?? '15m', limit = Math.min(Math.max(Math.round(+(req.query.limit ?? 1500)) || 1500, 500), 3000), min = Math.min(Math.max(Math.round(+(req.query.min ?? 70)) || 70, 30), 95);
  const slipAtr = Math.min(Math.max(+(req.query.slip ?? 0) || 0, 0), 2), feeR = Math.min(Math.max(+(req.query.fee ?? 0) || 0, 0), 1);
  const strategy = req.query.strategy === 'smc' ? 'smc' : 'confluence', requireHtf = req.query.htf !== '0';
  if (sym.length > 40 || !TF[tf] || (req.query.strategy && !['smc', 'confluence'].includes(req.query.strategy))) return reply.code(400).send({ error: 'invalid request' });
  const key = `${sym}|${tf}|${limit}|${min}|${strategy}|${requireHtf}|${slipAtr}|${feeR}`, hit = evidenceCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p.catch(e => reply.code(502).send({ error: e.message ?? 'evidence unavailable' }));
  const p = (async () => {
    const candles = (await loadCandles(sym, tf, Math.floor(Date.now() / 1000), limit)).slice(0, -1); // drop the still-forming candle
    if (candles.length < 300) throw Object.assign(new Error('not enough history'), { code: 404 });
    return { symbol: sym, tf, ...(await scenarioBacktest(candles, { tfSec: TF[tf], symbol: sym, tf, minScore: min, strategy, requireHtf, costs: { slipAtr, feeR } }, () => new Promise<void>(r => setImmediate(r)))) };
  })();
  evidenceCache.set(key, { at: Date.now(), p }); if (evidenceCache.size > 50) evidenceCache.delete(evidenceCache.keys().next().value as string);
  try { return await p; } catch (e: any) { evidenceCache.delete(key); return reply.code(e.code === 404 ? 404 : 502).send({ error: e.message ?? 'evidence unavailable' }); }
});
app.get<{ Querystring: { tf?: string } }>('/api/overview', async (req, reply) => {
  const tf = req.query.tf ?? '15m'; if (!TF[tf]) return reply.code(400).send({ error: 'invalid timeframe' });
  const rows = await scan(deriv, tf, 3, await swing(req)), by = new Map<string, any>();
  for (const r of rows) {
    const c = by.get(r.category) ?? { category: r.category, bullish: 0, bearish: 0, neutral: 0, total: 0, scoreSum: 0 };
    r.bias.includes('bull') ? c.bullish++ : r.bias.includes('bear') ? c.bearish++ : c.neutral++; c.total++; c.scoreSum += r.confluenceScore; by.set(r.category, c);
  }
  return { tf, scanned: rows.length, updatedAt: Date.now(), categories: [...by.values()].map(({ scoreSum, ...c }) => ({ ...c, avgConfluence: Math.round(scoreSum / c.total) })) };
});

// ---- AI chat: resolves markets/timeframes from the question, answers ONLY from deterministic analysis data ----
const CATS = ['volatility', 'boom', 'crash', 'jump', 'range break', 'step', 'drift'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliases = (name: string) => { const n = name.toLowerCase().replace(/ index$/, '').replace(/\s+/g, ' ').replace(/\s*\(/, ' ('), k = new Set([n]), v = n.match(/^volatility (\d+)( \(1s\))?$/); if (v) k.add(`v${v[1]}${v[2] ?? ''}`); return [...k]; };
function mentioned(q: string, list: any[]) {
  const hits: { sym: string; key: string }[] = [];
  for (const i of list) for (const k of aliases(i.name)) if (new RegExp(`(^|[^a-z0-9])${esc(k)}($|[^a-z0-9])`).test(q)) hits.push({ sym: i.symbol, key: k });
  return [...new Set(hits.filter(h => !hits.some(o => o.key.startsWith(h.key + ' '))).map(h => h.sym))];
}
function parseTfs(q: string) {
  const out = new Set<string>();
  for (const m of q.matchAll(/\b(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)\b/g)) { const k = `${m[1]}${m[2][0]}`; if (TF[k]) out.add(k); }
  return [...out].slice(0, 3);
}
app.post<{ Body: any }>('/api/ai/chat', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
  const q = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!q || q.length > 500) return reply.code(400).send({ error: 'A question is required (max 500 characters).' });
  const ql = q.toLowerCase().replace(/\s*\(/g, ' (');
  try {
    const list = (await deriv.instruments()) as any[], tfs = parseTfs(ql), tfList = tfs.length ? tfs : [TF[req.body.tf] ? req.body.tf : '15m'];
    let syms = mentioned(ql, list); const cat = CATS.find(c => ql.includes(c)), snapshots: any[] = [], events: Record<string, any[]> = {}; let overview: any, mode = 'markets';
    if (!syms.length && cat && /indices|indexes|across|overall|all |every|markets/.test(ql)) {
      mode = 'category';
      const rows = (await scan(deriv, tfList[0], 3, await swing(req))).filter(r => r.category.toLowerCase().startsWith(cat)), n = { bullish: 0, bearish: 0, neutral: 0 };
      rows.forEach(r => r.bias.includes('bull') ? n.bullish++ : r.bias.includes('bear') ? n.bearish++ : n.neutral++);
      overview = { category: cat, timeframe: tfList[0], markets: rows.length, ...n, top: rows.slice(0, 6) }; snapshots.push(...rows.slice(0, 4).map(r => ({ ...r, market: r.name })));
    } else {
      if (!syms.length) { if (typeof req.body?.symbol !== 'string') return reply.code(400).send({ error: 'Select or mention a market.' }); syms = [req.body.symbol]; }
      for (const s of syms.slice(0, 4)) for (const tf of tfList) {
        if (snapshots.length >= 6) break;
        const c = await deriv.candles(s, TF[tf], 500), name = list.find(i => i.symbol === s)?.name ?? s, sw = await swing(req);
        snapshots.push({ ...analyze(s, tf, c, sw).snapshot, market: name });
        events[`${name}|${tf}`] = historyEvents(c, sw.left, sw.right).events.slice(-8).map(e => ({ at: new Date(e.time * 1000).toISOString(), kind: e.kind, price: e.price }));
      }
    }
    let answer: string | null = null, notice: string | null = null;
    try { answer = await ai.chat({ snapshots, question: q, events, overview }); }
    catch (e: any) { req.log.warn({ err: e?.message }, 'ai chat unavailable'); notice = e instanceof AIUnavailableError ? e.message : 'AI analysis temporarily unavailable. Technical market analysis remains active.'; }
    const context = { mode, timeframes: tfList, markets: snapshots.map(s => s.market) };
    let conversationId: string | undefined; // history is saved for review only; the AI never sees earlier answers
    try {
      const want = typeof req.body?.conversationId === 'string' ? req.body.conversationId : '';
      conversationId = want && (await store.list(who(req), 'conversations', { where: { id: want } }).catch(() => [])).length ? want : (await store.add(who(req), 'conversations', { title: q.slice(0, 60) })).id;
      await store.add(who(req), 'messages', { conversationId, role: 'user', content: q });
      await store.add(who(req), 'messages', { conversationId, role: 'assistant', content: answer ?? '', notice, context, snapshots });
    } catch { req.log.warn('chat history not saved'); }
    return { answer, notice, context, snapshots, conversationId };
  } catch (e: any) { return reply.code(502).send({ error: e.message ?? 'chat unavailable' }); }
});
const byNewest = (a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt);
app.get('/api/backtests', async req => (await store.list(who(req), 'backtests', { cols: 'id,created_at,symbol,tf,rules,all:result->all,outOfSample:result->outOfSample' }))
  .map((r: any) => ({ id: r.id, createdAt: r.createdAt, symbol: r.symbol, tf: r.tf, rules: r.rules, all: r.all ?? r.result?.all, outOfSample: r.outOfSample ?? r.result?.outOfSample })).sort(byNewest));
app.get<{ Params: { id: string } }>('/api/backtests/:id', async (req, reply) => (await store.list(who(req), 'backtests', { where: { id: req.params.id } }).catch(() => []))[0] ?? reply.code(404).send({ error: 'not found' }));
app.delete<{ Params: { id: string } }>('/api/backtests/:id', async (req, reply) => (await store.remove(who(req), 'backtests', req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not found' }));
app.get('/api/conversations', async req => (await store.list(who(req), 'conversations')).sort(byNewest));
app.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (req, reply) => {
  const conv = await store.list(who(req), 'conversations', { where: { id: req.params.id } }).catch(() => []);
  return conv.length ? store.list(who(req), 'messages', { where: { conversationId: req.params.id } }) : reply.code(404).send({ error: 'not found' });
});
app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => (await store.remove(who(req), 'conversations', req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not found' }));
// ---- Journal screenshots (private; uploaded as a data URL, validated, served only to the owner) ----
const own = async (req: any, id: string) => (await store.list(who(req), 'journal', { where: { id } }).catch(() => []))[0];
app.post<{ Params: { id: string }; Body: any }>('/api/journal/:id/screenshot', { bodyLimit: 3_000_000, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
  const e = await own(req, req.params.id); if (!e) return reply.code(404).send({ error: 'not found' });
  const img = decodeImage(req.body?.dataUrl); if (!img) return reply.code(400).send({ error: 'Invalid image (PNG, JPEG or WebP, max 2 MB).' });
  const p = newPath(who(req).userId, img.ext); await shots.put(p, img.buf, img.mime);
  await store.update(who(req), 'journal', e.id, { screenshot: p });
  if (e.screenshot) await shots.del(e.screenshot).catch(() => {});
  return { ok: true };
});
app.get<{ Params: { id: string } }>('/api/journal/:id/screenshot', async (req, reply) => {
  const e = await own(req, req.params.id), s = e ? await shots.get(e.screenshot) : null; // the path comes from the owner's own row, never from the request
  if (!s) return reply.code(404).send({ error: 'not found' });
  return reply.header('Content-Type', s.mime).header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff').send(s.buf);
});
app.delete<{ Params: { id: string } }>('/api/journal/:id/screenshot', async (req, reply) => {
  const e = await own(req, req.params.id); if (!e) return reply.code(404).send({ error: 'not found' });
  if (e.screenshot) { await shots.del(e.screenshot).catch(() => {}); await store.update(who(req), 'journal', e.id, { screenshot: null }); }
  return { ok: true };
});
app.get('/api/preferences', async req => prefsFor(req));
app.put<{ Body: any }>('/api/preferences', async (req, reply) => {
  const b = req.body; if (!fieldsOk(b) || Object.keys(b).some(k => !(k in PREF_DEFAULTS))) return reply.code(400).send({ error: 'invalid preferences' });
  const row = (await store.list(who(req), 'preferences'))[0]; if (row) await store.update(who(req), 'preferences', row.id, b); else await store.add(who(req), 'preferences', b);
  prefCache.delete(who(req).userId); return prefsFor(req);
});
app.get<{ Params: { symbol: string }; Querystring: { tf?: string } }>('/api/setups/:symbol', async (req, reply) => { const tf = req.query.tf ?? '15m'; return TF[tf] ? readSetups(req.params.symbol, tf) : reply.code(400).send({ error: 'invalid timeframe' }); });
app.get('/api/reports', async req => (await store.list(who(req), 'reports')).sort(byNewest));
app.delete<{ Params: { id: string } }>('/api/reports/:id', async (req, reply) => (await store.remove(who(req), 'reports', req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not found' }));
await app.listen({ port: +(process.env.PORT || 3001), host: '0.0.0.0' });
