import { TF } from './scanner.js';
import type { Bus } from './bus.js';
type Client = { ws: any; key?: string; userId?: string; ready: Promise<boolean>; alive: boolean };
/** API side of the live feed: browser WebSockets <-> bus. Holds no market-data logic. */
export class Hub {
  private clients = new Set<Client>(); lastAt = 0; // last Deriv message time reported by the ingest side
  constructor(private bus: Bus) {
    setInterval(() => { for (const c of this.clients) { if (!c.alive) { c.ws.terminate(); this.clients.delete(c); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 30_000); // drop dead sockets
    setInterval(() => { for (const k of new Set([...this.clients].map(c => c.key).filter(Boolean))) { const [symbol, tf] = k!.split('|'); bus.publish('watch', { symbol, tf }); } }, 60_000); // keep-alive for streams clients are viewing
    bus.subscribe('heartbeat', m => { if (typeof m?.at === 'number') this.lastAt = m.at; });
    bus.subscribe('candle', m => {
      const key = `${m.symbol}|${m.tf}`, out = JSON.stringify({ type: 'candle', symbol: m.symbol, tf: m.tf, candle: m.candle });
      for (const c of this.clients) if (c.key === key && c.ws.readyState === 1) c.ws.send(out);
    });
    bus.subscribe('alert', m => {
      const out = JSON.stringify({ type: 'alert', alert: m.alert, price: m.price, text: m.text });
      for (const c of this.clients) if (c.userId === m.userId && c.ws.readyState === 1) c.ws.send(out);
    });
  }
  alertsChanged() { this.bus.publish('alerts', {}); }
  attach(ws: any, user: Promise<string | null>) {
    const c: Client = { ws, alive: true, ready: user.then(u => { if (!u) { ws.close(); return false; } c.userId = u; return true; }) }; this.clients.add(c);
    ws.on('message', (raw: any) => c.ready.then(ok => {
      if (!ok) return;
      try { const m = JSON.parse(raw.toString()); if (typeof m.sub === 'string' && m.sub.length < 40 && TF[m.tf]) { c.key = `${m.sub}|${m.tf}`; this.bus.publish('watch', { symbol: m.sub, tf: m.tf }); } } catch {}
    }));
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => this.clients.delete(c));
  }
}
