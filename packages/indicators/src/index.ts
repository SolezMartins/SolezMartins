import type { Candle } from '@dmi/types';
export const sma = (v: number[], p: number) => v.map((_, i) => i < p - 1 ? NaN : v.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
export function ema(v: number[], p: number) {
  const k = 2 / (p + 1); const out: number[] = [];
  v.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1] * (1 - k)));
  return out;
}
export function rsi(v: number[], p = 14) { // Wilder smoothing
  const out = v.map(() => NaN); if (v.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; d >= 0 ? g += d : l -= d; }
  g /= p; l /= p;
  for (let i = p; i < v.length; i++) {
    if (i > p) { const d = v[i] - v[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; }
    out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); // no movement at all = neutral 50, not 100
  }
  return out;
}
export function macd(v: number[], f = 12, s = 26, sig = 9) {
  const ef = ema(v, f), es = ema(v, s), line = ef.map((x, i) => x - es[i]), signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}
export function atr(c: Candle[], p = 14) {
  const tr = c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)));
  return ema(tr, p);
}

/** Rate of change over p candles, in percent. */
export const roc = (v: number[], p = 10) => v.map((x, i) => i < p ? NaN : ((x - v[i - p]) / v[i - p]) * 100);
/** Average high-low range of the last p candles. */
export const avgRange = (c: Candle[], p = 14) => { const r = c.slice(-p).map(x => x.high - x.low); return r.reduce((a, b) => a + b, 0) / r.length; };
/** Volatility regime: current ATR vs its average over the previous `look` candles (expanding > 1.25x, contracting < 0.8x). */
export function volatilityState(c: Candle[], p = 14, look = 50) {
  const a = atr(c, p), base = a.slice(-look - 1, -1); if (base.length < 10) return { ratio: 1, state: 'normal' as const };
  const ratio = a[a.length - 1] / (base.reduce((x, y) => x + y, 0) / base.length);
  return { ratio, state: (ratio > 1.25 ? 'expanding' : ratio < 0.8 ? 'contracting' : 'normal') as 'expanding' | 'contracting' | 'normal' };
}
/** Candlestick patterns on the last candle(s): doji, hammer, shooting star, engulfing. */
export function candlePatterns(c: Candle[]) {
  const out: { name: string; dir: 'bullish' | 'bearish' | 'neutral' }[] = []; if (c.length < 2) return out;
  const x = c[c.length - 1], p = c[c.length - 2], body = Math.abs(x.close - x.open), range = x.high - x.low || 1e-12;
  const up = x.high - Math.max(x.open, x.close), lo = Math.min(x.open, x.close) - x.low;
  if (body <= range * 0.1) out.push({ name: 'Doji', dir: 'neutral' });
  else {
    if (lo >= 2 * body && up <= body * 0.5) out.push({ name: 'Hammer', dir: 'bullish' });
    if (up >= 2 * body && lo <= body * 0.5) out.push({ name: 'Shooting star', dir: 'bearish' });
  }
  if (p.close < p.open && x.close > x.open && x.close >= p.open && x.open <= p.close) out.push({ name: 'Bullish engulfing', dir: 'bullish' });
  if (p.close > p.open && x.close < x.open && x.close <= p.open && x.open >= p.close) out.push({ name: 'Bearish engulfing', dir: 'bearish' });
  return out;
}
