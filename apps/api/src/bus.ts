import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { REDIS_URL, distributed } from './runtime.js';
import { child } from './log.js';
const log = child('bus');
/** Channels: candle (forming candle), alert, watch (client wants a stream), alerts (alert rules changed). */
export interface Bus { publish(ch: string, msg: unknown): void; subscribe(ch: string, cb: (m: any) => void): void }
class MemoryBus implements Bus {
  private ee = new EventEmitter().setMaxListeners(0);
  publish(ch: string, m: unknown) { this.ee.emit(ch, m); }
  subscribe(ch: string, cb: (m: any) => void) { this.ee.on(ch, cb); }
}
class RedisBus implements Bus {
  private pub = new Redis(REDIS_URL!);
  private sub = new Redis(REDIS_URL!);
  private handlers = new Map<string, ((m: any) => void)[]>();
  private lastErr = 0;
  constructor() {
    const onErr = (e: Error) => { if (Date.now() - this.lastErr > 30_000) { this.lastErr = Date.now(); log.warn({ err: e.message }, 'redis error'); } };
    this.pub.on('error', onErr); this.sub.on('error', onErr);
    this.sub.on('message', (ch, raw) => { try { const m = JSON.parse(raw); this.handlers.get(ch)?.forEach(cb => cb(m)); } catch {} });
  }
  publish(ch: string, m: unknown) { this.pub.publish(ch, JSON.stringify(m)).catch(() => {}); }
  subscribe(ch: string, cb: (m: any) => void) {
    if (!this.handlers.has(ch)) { this.handlers.set(ch, []); this.sub.subscribe(ch).catch(() => {}); }
    this.handlers.get(ch)!.push(cb);
  }
}
export const bus: Bus = distributed ? new RedisBus() : new MemoryBus();
