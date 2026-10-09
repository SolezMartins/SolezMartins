import { useEffect, useState } from 'react';

/**
 * Simulated Volatility / Boom / Crash feed for the login screen.
 * These are NOT live Deriv prices: they are generated locally to mimic how each index behaves
 * (volatility = random walk, boom = slow drift down with sudden spikes up, crash = the reverse).
 * Spike frequency is compressed so a visitor actually sees one within a minute or so.
 */
export type Kind = 'vol' | 'boom' | 'crash';
export interface Mkt { sym: string; name: string; sub: string; kind: Kind; icon: string; base: number; dec: number; sigma: number; spikeP?: number; spikeSize?: number }
export interface Candle { o: number; h: number; l: number; c: number }
export interface MState { price: number; prev: number; open: number; candles: Candle[]; k: number }

export const MARKETS: Mkt[] = [
  { sym: 'R_10', name: 'Volatility 10 Index', sub: 'Steady random walk', kind: 'vol', icon: 'V10', base: 6142.318, dec: 3, sigma: 0.00018 },
  { sym: 'R_75', name: 'Volatility 75 Index', sub: 'Fast random walk', kind: 'vol', icon: 'V75', base: 412850.41, dec: 2, sigma: 0.0007 },
  { sym: 'BOOM500', name: 'Boom 500 Index', sub: 'Drifts down, spikes up', kind: 'boom', icon: '▲', base: 5521.447, dec: 3, sigma: 0.00012, spikeP: 1 / 55, spikeSize: 0.0075 },
  { sym: 'CRASH500', name: 'Crash 500 Index', sub: 'Drifts up, spikes down', kind: 'crash', icon: '▼', base: 4873.206, dec: 3, sigma: 0.00012, spikeP: 1 / 55, spikeSize: 0.0075 },
  { sym: 'BOOM1000', name: 'Boom 1000 Index', sub: 'Drifts down, spikes up', kind: 'boom', icon: '▲', base: 10264.83, dec: 3, sigma: 0.0001, spikeP: 1 / 100, spikeSize: 0.009 },
  { sym: 'CRASH1000', name: 'Crash 1000 Index', sub: 'Drifts up, spikes down', kind: 'crash', icon: '▼', base: 9851.37, dec: 3, sigma: 0.0001, spikeP: 1 / 100, spikeSize: 0.009 },
];

export const MAX_CANDLES = 24;
const TICKS_PER_CANDLE = 6;

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

function step(m: Mkt, p: number): number {
  let r = gauss() * m.sigma + ((m.base - p) / m.base) * 0.01; // light mean reversion keeps prices near their base
  if (m.kind !== 'vol') {
    const q = m.spikeP!, s = m.spikeSize!, sign = m.kind === 'boom' ? 1 : -1;
    r += Math.random() < q ? sign * s * (0.6 + 0.8 * Math.random()) : -sign * q * s; // rare spike, small opposite drift
  }
  return p * (1 + r);
}

function tick(m: Mkt, st: MState): MState {
  const price = step(m, st.price), last = st.candles[st.candles.length - 1];
  const cur: Candle = { o: last.o, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price };
  const k = st.k + 1;
  if (k >= TICKS_PER_CANDLE) {
    const keep = st.candles.slice(st.candles.length >= MAX_CANDLES ? 1 : 0, -1);
    return { ...st, prev: st.price, price, k: 0, candles: [...keep, cur, { o: price, h: price, l: price, c: price }] };
  }
  return { ...st, prev: st.price, price, k, candles: [...st.candles.slice(0, -1), cur] };
}

function init(m: Mkt): MState {
  let st: MState = { price: m.base, prev: m.base, open: m.base, k: 0, candles: [{ o: m.base, h: m.base, l: m.base, c: m.base }] };
  for (let i = 0; i < MAX_CANDLES * TICKS_PER_CANDLE - 2; i++) st = tick(m, st); // pre-roll so the chart starts full
  return st;
}

/** One state per market, advanced every `ms`. Pauses while the tab is hidden. */
export function useMarketSim(ms = 900): MState[] {
  const [s, setS] = useState<MState[]>(() => MARKETS.map(init));
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setS(a => a.map((st, i) => tick(MARKETS[i], st))); }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return s;
}

export const fmt = (v: number, dec: number) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const pct = (st: MState) => ((st.price - st.open) / st.open) * 100;
export const signed = (v: number, dec: number) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), dec);
