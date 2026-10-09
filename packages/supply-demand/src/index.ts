import type { Candle, Fvg } from '@dmi/types';
/** 3-candle Fair Value Gap with fill tracking. */
export function fvgs(c: Candle[]): Fvg[] {
  const out: Fvg[] = [];
  for (let i = 2; i < c.length; i++) {
    let g: Fvg | null = null;
    if (c[i - 2].high < c[i].low) g = { dir: 'bullish', lower: c[i - 2].high, upper: c[i].low, i, filled: false };
    if (c[i - 2].low > c[i].high) g = { dir: 'bearish', upper: c[i - 2].low, lower: c[i].high, i, filled: false };
    if (g) { const fi = c.findIndex((x, j) => j > i && (g!.dir === 'bullish' ? x.low <= g!.lower : x.high >= g!.upper)); g.filled = fi >= 0; if (fi >= 0) g.filledI = fi;
      let ext = g.upper, ext2 = g.lower; for (let j = i + 1; j < c.length; j++) { ext = Math.min(ext, c[j].low); ext2 = Math.max(ext2, c[j].high); }
      g.fillPct = g.filled ? 1 : Math.min(1, Math.max(0, (g.dir === 'bullish' ? g.upper - ext : ext2 - g.lower) / (g.upper - g.lower || 1))); out.push(g); }
  }
  return out;
}

export interface Zone { dir: 'demand' | 'supply'; upper: number; lower: number; i: number; strength: number; tests: number; status: 'fresh' | 'tested' | 'invalidated' }
/** Potential zones: opposite-colour base candle followed by an impulse >= k*ATR. Not "institutional order blocks". */
export function zones(c: Candle[], atrs: number[], k = 1.5): Zone[] {
  const out: Zone[] = [];
  for (let i = 1; i < c.length - 1; i++) {
    const n = c[i + 1], body = n.close - n.open, a = atrs[i]; if (!a || Math.abs(body) < k * a) continue;
    const dir = body > 0 && c[i].close < c[i].open ? 'demand' : body < 0 && c[i].close > c[i].open ? 'supply' : null; if (!dir) continue;
    const z: Zone = { dir, upper: c[i].high, lower: c[i].low, i, strength: +(Math.abs(body) / a).toFixed(2), tests: 0, status: 'fresh' };
    for (const x of c.slice(i + 2)) {
      if (dir === 'demand' ? x.close < z.lower : x.close > z.upper) { z.status = 'invalidated'; break; }
      if (x.low <= z.upper && x.high >= z.lower) { z.tests++; z.status = 'tested'; }
    }
    out.push(z);
  }
  return out;
}
