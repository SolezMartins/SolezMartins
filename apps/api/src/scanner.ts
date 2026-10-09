import { analyze, scenario, smcRead, htfStructure } from '@dmi/strategies';
import type { DerivClient } from './deriv.js';
import { categorize, slugify } from './categories.js';
export const TF: Record<string, number> = { '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400 };
const cache = new Map<string, { at: number; row: any }>();
/** Scans every discovered instrument with low concurrency and 60s caching to respect Deriv limits. */
export async function scan(deriv: DerivClient, tf: string, concurrency = 3, sw: { left?: number; right?: number } = {}) {
  const list = (await deriv.instruments()) as any[]; const rows: any[] = []; let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = list[next++], key = `${i.symbol}:${tf}:${sw.left ?? 3}${sw.right ?? 3}`, hit = cache.get(key);
      if (hit && Date.now() - hit.at < 60_000) { rows.push(hit.row); continue; }
      try {
        const candles = await deriv.candles(i.symbol, TF[tf], 300), { snapshot, detail } = analyze(i.symbol, tf, candles, sw), z: any = [...detail.zones].sort((a: any, b: any) => a.distance - b.distance)[0];
        const last = candles[candles.length - 1].close, sc = scenario(snapshot, detail, last, detail.indicators.atr); // same function the market page uses; null when bias is neutral
        const row = { symbol: i.symbol, name: i.name, submarket: i.submarket, category: categorize(i.name, i.submarket), slug: slugify(i.name), price: last, zone: z && z.distance <= (detail.indicators.atr ?? 0) ? z.dir : null, ...snapshot, break: detail.break,
          scenario: sc ? { direction: sc.direction, entryZone: sc.entryZone, entryMid: sc.entryMid, invalidation: sc.invalidation, targets: sc.targets, estimatedRR: sc.estimatedRR, atr: sc.atr } : null };
        let smc: any = null; // SMC read on closed candles only, same as the market page and the SMC alert
        try { const done = candles.slice(0, -1), r = smcRead(done, htfStructure(done)), u = r?.setup;
          smc = u ? { direction: u.direction, status: u.status, ok: u.ok, htfAligned: u.htfAligned, entryZone: u.entryZone, entryMid: u.entryMid, invalidation: u.invalidation, targets: u.targets, estimatedRR: u.estimatedRR, atr: u.atr }
            : r?.partial ? { partial: true, direction: r.partial.direction } : null; } catch { smc = null; }
        (row as any).smc = smc;
        cache.set(key, { at: Date.now(), row }); rows.push(row);
      } catch { /* skip instrument on error; never fail the scan */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return rows.sort((a, b) => b.confluenceScore - a.confluenceScore);
}
