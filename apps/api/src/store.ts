import fs from 'node:fs'; import crypto from 'node:crypto';
import { supabaseEnabled, SB, ANON, SVC, type AuthUser } from './auth.js';
const ALLOWED = { watchlists: ['name', 'symbols', 'isDefault'], alerts: ['symbol', 'tf', 'kind', 'level', 'dir', 'active'],
  journal: ['symbol', 'direction', 'entry', 'stop', 'target', 'result', 'strategy', 'notes', 'lessons', 'screenshot', 'source', 'tf', 'confluence', 'entryStatus', 'filledAt', 'closedAt', 'exitPrice', 'rMultiple', 'scenarioStatus'], // the last eight need migration 0009 and scenarioStatus needs 0010 and are set only by the signal engine, never by clients
  backtests: ['symbol', 'tf', 'rules', 'result'], conversations: ['title'], messages: ['conversationId', 'role', 'content', 'notice', 'context', 'snapshots'],
  preferences: ['swingLeft', 'swingRight', 'defaultTf', 'defaultSymbol', 'notifications'],
  reports: ['symbol', 'timeframe', 'snapshot', 'explanation'] } as const;
export type Coll = keyof typeof ALLOWED;
export const KINDS = ['price_level', 'bos', 'choch', 'sweep', 'fvg', 'fvg_filled', 'enter_demand', 'enter_supply', 'zone_enter', 'ema_cross', 'rsi', 'confluence', 'signal', 'smc_signal', 'scenario_in_zone', 'scenario_invalidated', 'scenario_target'];
export type ListOpts = { cols?: string; where?: Record<string, string> };
const TRACKING = ['source', 'tf', 'confluence', 'entryStatus', 'filledAt', 'closedAt', 'exitPrice', 'rMultiple', 'scenarioStatus']; // 0009 columns, plus scenarioStatus from 0010
const pick = (c: Coll, b: any) => Object.fromEntries(ALLOWED[c].filter(k => b && b[k] !== undefined).map(k => [k, b[k]]));

// ---- Dev mode: local JSON file, scoped by userId ("local") ----
const FILE = process.env.STORE_FILE || 'data/store.json';
const data: Record<Coll, any[]> = { watchlists: [], alerts: [], journal: [], backtests: [], conversations: [], messages: [], preferences: [], reports: [] };
try { Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch {}
const save = () => { fs.mkdirSync('data', { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(data)); };
const fileStore = {
  async list(x: AuthUser, c: Coll, o: ListOpts = {}) { return data[c].filter(r => r.userId === x.userId && Object.entries(o.where ?? {}).every(([k, v]) => r[k] === v)); },
  async add(x: AuthUser, c: Coll, b: any) { const r = { id: crypto.randomUUID(), userId: x.userId, createdAt: Date.now(), ...(c === 'alerts' ? { active: true } : {}), ...pick(c, b) }; data[c].push(r); save(); return r; },
  async update(x: AuthUser, c: Coll, id: string, b: any) { const r = data[c].find(r => r.id === id && r.userId === x.userId); if (r) { Object.assign(r, pick(c, b)); save(); } return r ?? null; },
  async remove(x: AuthUser, c: Coll, id: string) {
    const n = data[c].length; data[c] = data[c].filter(r => !(r.id === id && r.userId === x.userId));
    const gone = data[c].length < n; if (gone && c === 'conversations') data.messages = data.messages.filter(m => m.conversationId !== id); // mirrors ON DELETE CASCADE
    save(); return gone;
  },
  async addFor(userId: string, c: Coll, b: any) { const r = { id: crypto.randomUUID(), userId, createdAt: Date.now(), ...pick(c, b) }; data[c].push(r); save(); return r; }, // engine-side insert for a given user
  async updateFor(id: string, patch: any) { const r = data.journal.find(r => r.id === id); if (r) { Object.assign(r, pick('journal', patch)); save(); } return r ?? null; }, // engine-side update of a signal entry
  async trackedSignals(sinceMs: number) { return data.journal.filter(r => r.source === 'signal' && (['pending', 'filled'].includes(r.entryStatus) || r.createdAt >= sinceMs)); },
  async activeAlerts() { return data.alerts.filter(a => a.active); },
  async fire(id: string) { const r = data.alerts.find(a => a.id === id); if (r) { r.active = false; r.triggeredAt = Date.now(); save(); } },
};

// ---- Supabase mode: user CRUD runs with the user's JWT so RLS enforces ownership; the alert engine uses the service role ----
const TABLE: Record<Coll, string> = { watchlists: 'watchlists', alerts: 'alerts', journal: 'trade_journal', backtests: 'backtest_runs', conversations: 'ai_conversations', messages: 'ai_messages', preferences: 'user_preferences', reports: 'analysis_reports' };
const RENAME: Record<string, string> = { user_id: 'userId', created_at: 'createdAt', triggered_at: 'triggeredAt', is_default: 'isDefault', conversation_id: 'conversationId', swing_left: 'swingLeft', swing_right: 'swingRight', default_tf: 'defaultTf', default_symbol: 'defaultSymbol', entry_status: 'entryStatus', filled_at: 'filledAt', closed_at: 'closedAt', exit_price: 'exitPrice', r_multiple: 'rMultiple', scenario_status: 'scenarioStatus' };
const REV = Object.fromEntries(Object.entries(RENAME).map(([k, v]) => [v, k]));
const fromDb = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [RENAME[k] ?? k, v]));
const toDb = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [REV[k] ?? k, v]));
const UUID = /^[0-9a-f-]{36}$/i;
async function rest(path: string, o: { method?: string; body?: any; jwt?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method: o.method ?? 'GET', body: o.body && JSON.stringify(o.body),
    headers: { apikey: o.jwt ? ANON! : SVC!, Authorization: `Bearer ${o.jwt ?? SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return (await r.json()) as any[];
}
const sbStore = {
  async list(x: AuthUser, c: Coll, o: ListOpts = {}) {
    const w = Object.entries(o.where ?? {}).map(([k, v]) => { if (!UUID.test(v)) throw new Error('bad id'); return `&${REV[k] ?? k}=eq.${v}`; }).join('');
    return (await rest(`${TABLE[c]}?select=${encodeURIComponent(o.cols ?? '*')}&order=created_at${w}`, { jwt: x.jwt })).map(fromDb);
  },
  async add(x: AuthUser, c: Coll, b: any) { return fromDb((await rest(TABLE[c], { method: 'POST', jwt: x.jwt, body: { ...toDb(pick(c, b)), user_id: x.userId } }))[0]); },
  async update(x: AuthUser, c: Coll, id: string, b: any) { if (!UUID.test(id)) return null; const r = await rest(`${TABLE[c]}?id=eq.${id}`, { method: 'PATCH', jwt: x.jwt, body: toDb(pick(c, b)) }); return r[0] ? fromDb(r[0]) : null; },
  async remove(x: AuthUser, c: Coll, id: string) { if (!UUID.test(id)) return false; return (await rest(`${TABLE[c]}?id=eq.${id}`, { method: 'DELETE', jwt: x.jwt })).length > 0; },
  async addFor(userId: string, c: Coll, b: any) { // service role: engine writes on the user's behalf
    try { return fromDb((await rest(TABLE[c], { method: 'POST', body: { ...toDb(pick(c, b)), user_id: userId } }))[0]); }
    catch (err) { // older schema: keep journaling the signal with whatever columns exist
      if (c !== 'journal') throw err;
      const without = (drop: string[]) => Object.fromEntries(Object.entries(pick(c, b)).filter(([k]) => !drop.includes(k)));
      try { return fromDb((await rest(TABLE[c], { method: 'POST', body: { ...toDb(without(['scenarioStatus'])), user_id: userId } }))[0]); } // 0009 applied, 0010 not yet: tracking works, no scenario status
      catch { return fromDb((await rest(TABLE[c], { method: 'POST', body: { ...toDb(without(TRACKING)), user_id: userId } }))[0]); } // 0009 missing too: journal only, no outcome tracking
    }
  },
  async updateFor(id: string, patch: any) { if (!UUID.test(id)) return null; const r = await rest(`trade_journal?id=eq.${id}`, { method: 'PATCH', body: toDb(pick('journal', patch)) }); return r[0] ? fromDb(r[0]) : null; },
  async trackedSignals(sinceMs: number) { // open signal entries (pending/filled) plus recent ones, for outcome tracking and duplicate checks; [] if migration 0009 is missing
    const since = new Date(sinceMs).toISOString();
    const [a, b] = await Promise.all([rest('trade_journal?source=eq.signal&entry_status=in.(pending,filled)&result=eq.open&select=*'), rest(`trade_journal?source=eq.signal&created_at=gte.${encodeURIComponent(since)}&select=*`)]);
    return [...new Map([...a, ...b].map(r => [r.id, r])).values()].map(fromDb);
  },
  async activeAlerts() { return (await rest('alerts?active=eq.true&select=*')).map(fromDb); },
  async fire(id: string) { if (UUID.test(id)) await rest(`alerts?id=eq.${id}`, { method: 'PATCH', body: { active: false, triggered_at: new Date().toISOString() } }); },
};
export const store = supabaseEnabled ? sbStore : fileStore;
