import type { Candle, Swing } from '@dmi/types';
/** Configurable fractal swing detection: a swing needs `left`/`right` lower/higher neighbours. */
export function swings(c: Candle[], left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < c.length - right; i++) {
    let hi = true, lo = true;
    for (let j = i - left; j <= i + right; j++) { // strict on the left, non-strict on the right: a flat top/bottom yields ONE swing (its first candle)
      if (j === i) continue;
      if (j < i) { if (c[j].high >= c[i].high) hi = false; if (c[j].low <= c[i].low) lo = false; }
      else { if (c[j].high > c[i].high) hi = false; if (c[j].low < c[i].low) lo = false; }
    }
    if (hi) out.push({ i, type: 'high', price: c[i].high });
    if (lo) out.push({ i, type: 'low', price: c[i].low });
  }
  return out.sort((a, b) => a.i - b.i);
}
export type Structure = 'bullish' | 'bearish' | 'range';
/** HH+HL => bullish, LH+LL => bearish, otherwise range. */
export function classify(s: Swing[]): { structure: Structure; labels: string[] } {
  const h = s.filter(x => x.type === 'high').slice(-2), l = s.filter(x => x.type === 'low').slice(-2);
  if (h.length < 2 || l.length < 2) return { structure: 'range', labels: [] };
  const hh = h[1].price > h[0].price, hl = l[1].price > l[0].price;
  const labels = [hh ? 'HH' : 'LH', hl ? 'HL' : 'LL'];
  return { structure: hh && hl ? 'bullish' : !hh && !hl ? 'bearish' : 'range', labels };
}
/** BOS = close breaks last swing in trend direction; CHOCH = close breaks against trend. */
export function breaks(c: Candle[], s: Swing[], structure: Structure) {
  const last = c[c.length - 1]; const h = s.filter(x => x.type === 'high').pop(), l = s.filter(x => x.type === 'low').pop();
  if (h && last.close > h.price) return structure === 'bearish' ? 'CHOCH_BULLISH' : 'BOS_BULLISH';
  if (l && last.close < l.price) return structure === 'bullish' ? 'CHOCH_BEARISH' : 'BOS_BEARISH';
  return null;
}

/** Repeated reaction zones: swing prices clustered within 0.5 ATR; 2+ touches = a major level. Nearest 3 per side. */
export function keyLevels(sw: Swing[], price: number, atrNow: number) {
  const tol = Math.max(atrNow * 0.5, price * 1e-6), groups: { sum: number; n: number; start: number }[] = [];
  for (const p of sw.map(s => s.price).sort((a, b) => a - b)) { const g = groups[groups.length - 1]; if (g && p - g.start <= tol) { g.sum += p; g.n++; } else groups.push({ sum: p, n: 1, start: p }); }
  const lv = groups.filter(g => g.n >= 2).map(g => ({ price: g.sum / g.n, touches: g.n })), near = (a: { price: number }, b: { price: number }) => Math.abs(a.price - price) - Math.abs(b.price - price);
  return { support: lv.filter(l => l.price < price).sort(near).slice(0, 3), resistance: lv.filter(l => l.price >= price).sort(near).slice(0, 3) };
}
/** Range (30 candles fit within 5 ATR), expansion (recent candle ranges > 1.6x the prior ones) or trend. */
export function rangeState(c: Candle[], atrNow: number, look = 30): { state: 'range' | 'expansion' | 'trend'; high?: number; low?: number } {
  const w = c.slice(-look), hi = Math.max(...w.map(x => x.high)), lo = Math.min(...w.map(x => x.low));
  const avg = (a: Candle[]) => a.reduce((s, x) => s + (x.high - x.low), 0) / (a.length || 1), recent = avg(c.slice(-5)), prior = avg(c.slice(-35, -5));
  if (hi - lo <= 5 * atrNow) return { state: 'range', high: hi, low: lo };
  return recent > 1.6 * prior ? { state: 'expansion' } : { state: 'trend' };
}
