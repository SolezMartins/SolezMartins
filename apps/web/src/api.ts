/** JSON helper. Auth headers are added by the global fetch wrapper in main.tsx. */
export async function send(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as any)?.error ?? `Request failed (${r.status})`);
  return r.json();
}

/** WebSocket origin: derived from VITE_API_URL when set (Vercel), else the page's own host (dev proxy). */
const wsBase = () => { const a = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, ''); return a ? a.replace(/^http/, 'ws') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`; };

/** Shared auth state (set by the login flow in main.tsx). */
export const auth = { token: '' };
/** User preferences loaded after login (defaults until then). */
export const prefs = { defaultTf: '15m', notifications: true };
/**
 * Live socket with automatic reconnect (exponential backoff + jitter, fresh auth token each attempt, resubscribe on open).
 * Pass sym/tf = null for an alerts-only connection. onState fires 'open' (again = true after a reconnect, so callers can refetch missed data) or 'reconnecting'.
 */
export function liveSocket(sym: string | null, tf: string | null, onMsg: (m: any) => void, onState?: (s: 'open' | 'reconnecting', again: boolean) => void) {
  let ws: WebSocket | undefined, stop = false, tries = 0, timer: any, opened = false;
  const connect = () => {
    ws = new WebSocket(`${wsBase()}/ws?token=${encodeURIComponent(auth.token)}`);
    ws.onopen = () => { const again = opened; opened = true; tries = 0; if (sym && tf) ws!.send(JSON.stringify({ sub: sym, tf })); onState?.('open', again); };
    ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { if (stop) return; onState?.('reconnecting', opened); timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++) * (0.7 + Math.random() * 0.6)); };
  };
  connect();
  return () => { stop = true; clearTimeout(timer); ws?.close(); };
}
