import fs from 'node:fs/promises'; import path from 'node:path'; import crypto from 'node:crypto';
import { supabaseEnabled, SB, SVC } from './auth.js';
const BUCKET = 'journal-screenshots', ROOT = path.resolve(process.env.SCREENSHOT_DIR || 'data/screenshots'), MAX_BYTES = 2_000_000;
/** Decode a data URL and accept only PNG/JPEG/WebP, verified by magic bytes (the declared type is not trusted). */
export function decodeImage(dataUrl: unknown) {
  const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/) : null; if (!m) return null;
  const buf = Buffer.from(m[1], 'base64'); if (buf.length < 16 || buf.length > MAX_BYTES) return null;
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { buf, ext: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { buf, ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { buf, ext: 'webp', mime: 'image/webp' };
  return null;
}
export const newPath = (userId: string, ext: string) => `${userId}/${crypto.randomUUID()}.${ext}`;
const safe = (p: unknown): p is string => typeof p === 'string' && /^[0-9a-zA-Z_-]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(p); // paths are server-generated; validated again anyway
const mimeOf = (p: string) => p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
const url = (p: string) => `${SB}/storage/v1/object/${BUCKET}/${p}`, auth = () => ({ apikey: SVC!, Authorization: `Bearer ${SVC}` });
export const shots = {
  async put(p: string, buf: Buffer, mime: string) {
    if (!safe(p)) throw new Error('bad path');
    if (supabaseEnabled) { const r = await fetch(url(p), { method: 'POST', headers: { ...auth(), 'Content-Type': mime, 'x-upsert': 'true' }, body: buf }); if (!r.ok) throw new Error(`storage ${r.status}`); return; }
    const f = path.join(ROOT, p); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, buf);
  },
  async get(p: unknown) {
    if (!safe(p)) return null;
    if (supabaseEnabled) { const r = await fetch(url(p), { headers: auth() }).catch(() => null); return r?.ok ? { buf: Buffer.from(await r.arrayBuffer()), mime: mimeOf(p) } : null; }
    return fs.readFile(path.join(ROOT, p)).then(buf => ({ buf, mime: mimeOf(p) })).catch(() => null);
  },
  async del(p: unknown) {
    if (!safe(p)) return;
    if (supabaseEnabled) { await fetch(url(p), { method: 'DELETE', headers: auth() }); return; }
    await fs.rm(path.join(ROOT, p), { force: true });
  },
};
