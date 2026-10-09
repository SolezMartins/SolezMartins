import { SB, SVC, supabaseEnabled } from './auth.js';
import { child } from './log.js';
const log = child('audit'), queue: any[] = [], UUID = /^[0-9a-f-]{36}$/i, HOUR = 3_600_000;
/** Security/audit trail: who did what, when, from where. Never records request bodies, tokens or chat/journal content. */
export function audit(e: { userId?: string; action: string; resource?: string; status?: number; ip?: string; meta?: object }) {
  const row = { user_id: e.userId && UUID.test(e.userId) ? e.userId : null, action: e.action, resource: e.resource ?? null, status: e.status ?? null, ip: e.ip ?? null, meta: e.meta ?? null, created_at: new Date().toISOString() };
  log.info(row, 'audit'); // always written to the structured log
  if (supabaseEnabled) { queue.push(row); if (queue.length > 5000) queue.shift(); }
}
const rest = (path: string, body: unknown) => fetch(`${SB}/rest/v1/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' } });
async function flush() {
  while (queue.length) {
    const batch = queue.splice(0, 200), r = await rest('audit_logs', batch).catch(() => null);
    if (!r?.ok) { queue.unshift(...batch); log.warn({ status: r?.status }, 'audit flush failed, will retry'); return; }
  }
}
if (supabaseEnabled) {
  setInterval(flush, 10_000);
  setInterval(() => rest('rpc/prune_audit_logs', { keep_days: Number(process.env.AUDIT_RETENTION_DAYS) || 365 }).catch(() => {}), 6 * HOUR);
}
