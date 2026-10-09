import { useEffect, useRef, useState } from 'react';
import { createChart, type UTCTimestamp } from 'lightweight-charts';
import { prefs, send } from './api';

const KINDS = ['sweep', 'bos', 'choch', 'fvg', 'zone'];
const f = (v: number | null, d = 2, pct = false) => v === null || v === undefined ? '-' : pct ? (v * 100).toFixed(1) + '%' : v.toFixed(d);
export function Backtest({ sym, setSym }: { sym: string; setSym: (s: string) => void }) {
  const [inst, setInst] = useState<any[]>([]), [tf, setTf] = useState(prefs.defaultTf), [limit, setLimit] = useState(2000), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState<any>(null);
  const [save, setSave] = useState(false), [saved, setSaved] = useState<any[]>([]), [costs, setCosts] = useState({ slipAtr: 0, feeR: 0 });
  const [rules, setRules] = useState<any>({ direction: 'long', require: ['sweep', 'bos', 'fvg'], window: 20, stopAtr: 1.5, rr: 2, maxHold: 50, htfFactor: 4 });
  const el = useRef<HTMLDivElement>(null);
  const loadSaved = () => send('GET', '/api/backtests').then(setSaved).catch(() => {});
  const open = (id: string) => send('GET', `/api/backtests/${id}`).then(r => { setRes(r.result); setSym(r.symbol); setTf(r.tf); setRules(r.rules); setCosts({ slipAtr: r.result?.costs?.slipAtr ?? 0, feeR: r.result?.costs?.feeR ?? 0 }); setErr(''); }).catch(e => setErr(e.message));
  const del = (id: string) => confirm('Delete this saved run?') && send('DELETE', `/api/backtests/${id}`).then(loadSaved).catch(e => setErr(e.message));
  useEffect(() => { send('GET', '/api/instruments').then(setInst).catch(() => {}); loadSaved(); }, []);
  const set = (k: string, num = false) => (e: any) => setRules({ ...rules, [k]: num ? +e.target.value : e.target.value });
  const toggle = (k: string) => setRules({ ...rules, require: rules.require.includes(k) ? rules.require.filter((x: string) => x !== k) : [...rules.require, k] });
  const run = () => { setBusy(true); setErr(''); send('POST', '/api/backtest', { symbol: sym, tf, limit, rules, costs, save }).then(r => { setRes(r); if (r.savedId) loadSaved(); }).catch(e => { setRes(null); setErr(e.message); }).finally(() => setBusy(false)); };
  useEffect(() => {
    if (!res?.equity.length || !el.current) return;
    const ch = createChart(el.current, { height: 220, layout: { background: { color: '#0b0e14' }, textColor: '#9aa3b5' }, grid: { vertLines: { color: '#141925' }, horzLines: { color: '#141925' } }, timeScale: { timeVisible: true } });
    ch.addLineSeries({ color: '#26a69a' }).setData(res.equity.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.r }))); return () => ch.remove();
  }, [res]);
  const row = (name: string, s: any) => <tr><td>{name}</td><td>{s.setups}</td><td>{s.winners}</td><td>{s.losers}</td><td>{f(s.winRate, 1, true)}</td><td>{f(s.avgR)}</td><td>{f(s.totalR)}</td><td>{f(s.profitFactor)}</td><td>{f(s.payoff)}</td><td>{f(s.maxDrawdownR)}</td><td>{s.maxConsecWins}/{s.maxConsecLosses}</td><td>{f(s.avgBars, 1)}</td></tr>;
  return <div style={{ padding: 16 }}>
    <b>Backtesting</b> <small>(deterministic rules on stored/Deriv history; nothing is executed)</small>
    <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', margin: '12px 0' }}>
      <select value={sym} onChange={e => setSym(e.target.value)}>{inst.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select>
      <select value={tf} onChange={e => setTf(e.target.value)}>{['1m', '2m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map(t => <option key={t}>{t}</option>)}</select>
      <select value={limit} onChange={e => setLimit(+e.target.value)}>{[1000, 2000, 5000].map(n => <option key={n} value={n}>{n} candles</option>)}</select>
      <select value={rules.direction} onChange={set('direction')}><option>long</option><option>short</option></select>
      <label>Within <input type="number" value={rules.window} onChange={set('window', true)} style={{ width: 50 }} /> candles</label>
      <label>Stop <input type="number" step="0.1" value={rules.stopAtr} onChange={set('stopAtr', true)} style={{ width: 50 }} /> x ATR</label>
      <label>Target <input type="number" step="0.1" value={rules.rr} onChange={set('rr', true)} style={{ width: 50 }} /> R</label>
      <label>Max hold <input type="number" value={rules.maxHold} onChange={set('maxHold', true)} style={{ width: 50 }} /> candles</label>
      <label title="Adverse slippage on the market entry and on stop/timeout exits, as a fraction of ATR. 0 = none.">Slippage <input type="number" min={0} max={2} step="0.05" value={costs.slipAtr} onChange={e => setCosts({ ...costs, slipAtr: Math.min(2, Math.max(0, +e.target.value || 0)) })} style={{ width: 55 }} /> x ATR</label>
      <label title="Flat cost per trade in R (fees plus spread). 0 = none.">Fees <input type="number" min={0} max={1} step="0.01" value={costs.feeR} onChange={e => setCosts({ ...costs, feeR: Math.min(1, Math.max(0, +e.target.value || 0)) })} style={{ width: 55 }} /> R / trade</label>
      <select value={rules.htfFactor} onChange={set('htfFactor', true)}><option value={0}>No HTF filter</option>{[2, 3, 4, 6, 8, 12, 24].map(n => <option key={n} value={n}>HTF trend = {n} x timeframe</option>)}</select></div>
    <div>Require (all, aligned with direction): {KINDS.map(k => <label key={k} style={{ marginRight: 10 }}><input type="checkbox" checked={rules.require.includes(k)} onChange={() => toggle(k)} />{k}</label>)}
      <label className="mx-2"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} /> Save this run</label><button onClick={run} disabled={busy || !rules.require.length}>{busy ? 'Running...' : 'Run backtest'}</button></div>
    <small style={{ color: '#e06c6c' }}>{err}</small>
    {!!saved.length && <div className="mt-4"><b>Saved runs</b> <small>(latest 50; stored exactly as the engine produced them)</small>
      <table><thead><tr>{['Saved', 'Market', 'TF', 'Direction', 'Requires', 'Setups', 'Avg R', 'OOS avg R', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{saved.map(s => <tr key={s.id}><td>{new Date(s.createdAt).toLocaleString()}</td><td>{inst.find(i => i.symbol === s.symbol)?.name ?? s.symbol}</td><td>{s.tf}</td><td>{s.rules.direction}</td><td>{s.rules.require.join('+')}</td><td>{s.all?.setups}</td><td>{f(s.all?.avgR)}</td><td>{f(s.outOfSample?.avgR)}</td>
          <td><button onClick={() => open(s.id)}>Open</button> <button onClick={() => del(s.id)}>Delete</button></td></tr>)}</tbody></table></div>}
    {res && <div style={{ marginTop: 12 }}>
      <small>{res.candles} candles, {new Date(res.from * 1000).toLocaleDateString()} to {new Date(res.to * 1000).toLocaleDateString()}. Split at {new Date(res.splitTime * 1000).toLocaleDateString()}.</small>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}><thead><tr>{['', 'Setups', 'Winners', 'Losers', 'Win rate', 'Avg R', 'Total R', 'Profit factor', 'Avg win/loss', 'Max DD (R)', 'Streak W/L', 'Avg bars'].map(h => <th key={h} align="left">{h}</th>)}</tr></thead>
        <tbody>{row('All', res.all)}{row('In-sample (70%)', res.inSample)}{row('Out-of-sample (30%)', res.outOfSample)}</tbody></table>
      {res.notes.map((n: string, i: number) => <div key={i}><small>{n}</small></div>)}
      <div ref={el} style={{ margin: '12px 0' }} />
      <div style={{ maxHeight: 240, overflow: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Entry time', 'Dir', 'Entry', 'Stop', 'Target', 'Exit', 'Reason', 'R', 'Bars'].map(h => <th key={h} align="left">{h}</th>)}</tr></thead>
        <tbody>{[...res.trades].reverse().slice(0, 100).map((t: any, i: number) => <tr key={i}><td>{new Date(t.entryTime * 1000).toLocaleString()}</td><td>{t.dir}</td><td>{t.entry}</td><td>{f(t.stop, 4)}</td><td>{f(t.target, 4)}</td><td>{f(t.exit, 4)}</td><td>{t.reason}</td><td>{f(t.r)}</td><td>{t.bars}</td></tr>)}</tbody></table></div>
    </div>}
  </div>;
}
