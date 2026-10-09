import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, type UTCTimestamp } from 'lightweight-charts';
import { prefs, send } from './api';

const GROUPS = ['BOS', 'CHOCH', 'SWEEP', 'FVG', 'ZONE', 'SWING'];
const grp = (k: string) => k.split('_')[0];
const col = (d: string) => d === 'bullish' ? '#26a69a' : d === 'bearish' ? '#ef5350' : '#9aa3b5';

export function History({ sym, setSym }: { sym: string; setSym: (s: string) => void }) {
  const [inst, setInst] = useState<any[]>([]), [tf, setTf] = useState(prefs.defaultTf), [limit, setLimit] = useState(500), [date, setDate] = useState('');
  const [data, setData] = useState<any>(null), [cut, setCut] = useState(0), [play, setPlay] = useState(false), [err, setErr] = useState('');
  const [show, setShow] = useState<Set<string>>(new Set(['BOS', 'CHOCH', 'SWEEP']));
  const el = useRef<HTMLDivElement>(null), chart = useRef<any>(null), series = useRef<any>(null);
  useEffect(() => { send('GET', '/api/instruments').then(setInst).catch(() => {}); }, []);
  useEffect(() => {
    setErr(''); setPlay(false);
    const to = date ? Math.floor(Date.parse(date + 'T23:59:59Z') / 1000) : '';
    send('GET', `/api/history/${sym}?tf=${tf}&limit=${limit}${to ? `&to=${to}` : ''}`).then(d => { setData(d); setCut(d.candles.length); }).catch(e => { setData(null); setErr(e.message); });
  }, [sym, tf, limit, date]);
  useEffect(() => {
    if (!el.current) return;
    chart.current = createChart(el.current, { height: 460, layout: { background: { color: '#0b0e14' }, textColor: '#9aa3b5' }, grid: { vertLines: { color: '#141925' }, horzLines: { color: '#141925' } }, timeScale: { timeVisible: true } });
    series.current = chart.current.addCandlestickSeries(); return () => chart.current.remove();
  }, []);
  const n = data?.candles.length ?? 0, now = data && cut > 0 ? data.candles[cut - 1].time : 0;
  useEffect(() => { if (!play) return; const t = setInterval(() => setCut(c => Math.min(c + 1, n)), 250); return () => clearInterval(t); }, [play, n]);
  useEffect(() => { if (cut >= n) setPlay(false); }, [cut, n]);
  const events = useMemo(() => data ? data.events.filter((e: any) => e.time <= now && show.has(grp(e.kind))) : [], [data, now, show]);
  useEffect(() => {
    if (!data || !series.current) return;
    series.current.setData(data.candles.slice(0, cut).map((c: any) => ({ ...c, time: c.time as UTCTimestamp })));
    const m: any[] = events.filter((e: any) => !['FVG', 'ZONE'].includes(grp(e.kind))).map((e: any) => ({ time: e.time as UTCTimestamp, position: e.dir === 'bearish' ? 'aboveBar' : 'belowBar', color: col(e.dir),
      shape: grp(e.kind) === 'SWEEP' ? 'circle' : e.dir === 'bearish' ? 'arrowDown' : 'arrowUp', text: grp(e.kind) === 'SWEEP' ? 'SW' : grp(e.kind) }));
    if (show.has('SWING')) for (const s of data.swings.filter((s: any) => s.confirmedAt <= now)) m.push({ time: s.time as UTCTimestamp, position: s.type === 'high' ? 'aboveBar' : 'belowBar', color: '#9aa3b5', shape: 'circle', text: '' });
    series.current.setMarkers(m.sort((a, b) => a.time - b.time));
  }, [data, cut, events, show]);
  const toggle = (g: string) => setShow(s => { const x = new Set(s); x.has(g) ? x.delete(g) : x.add(g); return x; });
  const fmt = (t: number) => new Date(t * 1000).toLocaleString();
  return <div style={{ padding: 16 }}>
    <select value={sym} onChange={e => setSym(e.target.value)}>{inst.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select>{' '}
    <select value={tf} onChange={e => setTf(e.target.value)}>{['1m', '2m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map(t => <option key={t}>{t}</option>)}</select>{' '}
    Up to <input type="date" value={date} onChange={e => setDate(e.target.value)} /> <button onClick={() => setDate('')}>Latest</button>{' '}
    <button onClick={() => setLimit(l => Math.min(l * 2, 2000))} disabled={limit >= 2000}>Load more ({limit})</button>
    <div>{GROUPS.map(g => <label key={g} style={{ marginRight: 10 }}><input type="checkbox" checked={show.has(g)} onChange={() => toggle(g)} />{g}</label>)}</div>
    <small style={{ color: '#e06c6c' }}>{err}</small>
    <div ref={el} style={{ margin: '8px 0' }} />
    {data && <div>Replay <button onClick={() => setCut(c => Math.max(20, c - 1))}>-1</button> <button onClick={() => setPlay(p => !p)}>{play ? 'Pause' : 'Play'}</button> <button onClick={() => setCut(c => Math.min(n, c + 1))}>+1</button>{' '}
      <input type="range" min={20} max={n} value={cut} onChange={e => { setPlay(false); setCut(+e.target.value); }} style={{ width: 320 }} /> <small>{fmt(now)}</small>
      <div><small>Events use only data available at each candle (swings confirm 3 candles after forming). Zone status is as of the latest loaded candle.</small></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
        <div style={{ maxHeight: 260, overflow: 'auto' }}><b>Events ({events.length})</b>{[...events].reverse().slice(0, 200).map((e: any, i: number) => <div key={i} style={{ color: col(e.dir) }}>{fmt(e.time)} {e.kind.replace('_', ' ')} @ {e.price}</div>)}</div>
        <div style={{ maxHeight: 260, overflow: 'auto' }}><b>FVG and zones</b>
          {[...data.fvgs.filter((g: any) => g.time <= now).map((g: any) => ({ ...g, t: 'FVG', s: g.filledAt && g.filledAt <= now ? 'filled' : 'open' })), ...data.zones.filter((z: any) => z.time <= now).map((z: any) => ({ ...z, t: z.dir, s: z.status }))]
            .sort((a, b) => b.time - a.time).slice(0, 60).map((x: any, i: number) => <div key={i} style={{ color: col(x.dir === 'demand' ? 'bullish' : x.dir === 'supply' ? 'bearish' : x.dir) }}>{fmt(x.time)} {x.t} {x.lower} - {x.upper} ({x.s})</div>)}</div>
      </div></div>}
  </div>;
}
