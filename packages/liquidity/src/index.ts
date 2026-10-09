import type { Candle, Swing } from '@dmi/types';
/** Equal highs/lows within tolerance (fraction of price) = resting liquidity pools. */
export function equalLevels(s: Swing[], tol = 0.0005) {
  const out: { type: 'high' | 'low'; price: number }[] = [];
  for (let a = 0; a < s.length; a++) for (let b = a + 1; b < s.length; b++)
    if (s[a].type === s[b].type && Math.abs(s[a].price - s[b].price) / s[a].price <= tol) out.push({ type: s[a].type, price: s[a].price });
  return out;
}
/** Sweep: wick trades through a prior swing but the candle closes back inside. Low sweep => bullish, high sweep => bearish. */
export function sweeps(c: Candle[], s: Swing[], lookback = 20) {
  const out: { i: number; level: number; dir: 'bullish' | 'bearish' }[] = [];
  for (let i = Math.max(1, c.length - lookback); i < c.length; i++)
    for (const w of s) {
      if (w.i >= i - 1) continue;
      if (w.type === 'low' && c[i].low < w.price && c[i].close > w.price) out.push({ i, level: w.price, dir: 'bullish' });
      if (w.type === 'high' && c[i].high > w.price && c[i].close < w.price) out.push({ i, level: w.price, dir: 'bearish' });
    }
  return out;
}
