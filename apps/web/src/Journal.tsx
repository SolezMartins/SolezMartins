import { useEffect, useMemo, useState } from 'react';
import { send } from './api';
import { Shot } from './Shot';
import { toDataUrl } from './image';

const blank = { symbol: '', direction: 'long', entry: '', stop: '', target: '', result: 'open', strategy: '', notes: '', lessons: '' };
const plannedR = (e: any) => { const r = Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop); return Number.isFinite(r) ? r : null; };
const RESULTS = ['open', 'win', 'loss', 'breakeven', 'expired', 'missed'];
// Auto-tracked signals carry their measured R; manual entries use the planned target for wins. 'missed' (order never filled) has no R.
const realizedR = (e: any) => e.result === 'missed' ? null : Number.isFinite(Number(e.rMultiple)) && e.rMultiple !== null ? Number(e.rMultiple) : e.result === 'loss' ? -1 : e.result === 'breakeven' ? 0 : e.result === 'expired' ? null : plannedR(e);
const status = (e: any) => e.source !== 'signal' || !e.entryStatus ? '' : e.entryStatus === 'pending' && e.result === 'open' ? 'Waiting for entry' : e.entryStatus === 'filled' && e.result === 'open' ? 'In trade (tracked)' : e.result === 'missed' ? 'Never filled' : e.exitPrice != null ? `Closed @ ${e.exitPrice}` : '';
export function Journal() {
  const [rows, setRows] = useState<any[]>([]), [inst, setInst] = useState<any[]>([]), [f, setF] = useState<any>(blank), [err, setErr] = useState(''), [shot, setShot] = useState<string | null>(null);
  const fail = (e: any) => setErr(e.message ?? 'Something went wrong');
  const pick = (file: File) => toDataUrl(file).then(setShot).catch(fail);
  const load = () => send('GET', '/api/journal').then(r => { setErr(''); setRows(r.sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))); }).catch(fail);
  useEffect(() => { load(); send('GET', '/api/instruments').then(setInst).catch(() => {}); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const n = (v: string) => v === '' ? undefined : +v;
    if (!f.symbol || !Number.isFinite(+f.entry) || f.entry === '') return setErr('Market and entry are required.');
    send('POST', '/api/journal', { ...f, entry: n(f.entry), stop: n(f.stop), target: n(f.target) }).then(async r => { if (shot) await send('POST', `/api/journal/${r.id}/screenshot`, { dataUrl: shot }); setF(blank); setShot(null); return load(); }).catch(fail);
  };
  const stats = useMemo(() => {
    const closed = rows.filter(r => r.result && r.result !== 'open' && r.result !== 'missed').reverse(); // oldest first
    const wins = closed.filter(r => r.result === 'win').length, losses = closed.filter(r => r.result === 'loss').length, signals = rows.filter(r => r.source === 'signal'), missed = rows.filter(r => r.result === 'missed').length;
    const rs = closed.map(realizedR).filter((x): x is number => x !== null);
    let cw = 0, cl = 0, mw = 0, ml = 0;
    for (const r of closed) { cw = r.result === 'win' ? cw + 1 : 0; cl = r.result === 'loss' ? cl + 1 : 0; mw = Math.max(mw, cw); ml = Math.max(ml, cl); }
    return { missed, waiting: signals.filter(r => r.result === 'open' && r.entryStatus === 'pending').length, total: rows.length, closed: closed.length, wins, losses, be: closed.length - wins - losses, winRate: closed.length ? (100 * wins / closed.length) : null,
      totalR: rs.reduce((a, b) => a + b, 0), avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, mw, ml };
  }, [rows]);
  const nameOf = (s: string) => inst.find(i => i.symbol === s)?.name ?? s;
  const box = { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' };
  return <div style={{ padding: 16 }}>
    <b>Trade journal</b> <small>(manual records only; nothing is executed)</small>
    <div style={{ ...box, margin: '12px 0' }} onPaste={e => { const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/')); if (f) pick(f); }}>
      <select value={f.symbol} onChange={set('symbol')}><option value="">Market...</option>{inst.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select>
      <select value={f.direction} onChange={set('direction')}><option>long</option><option>short</option></select>
      <input placeholder="entry" value={f.entry} onChange={set('entry')} /><input placeholder="stop loss" value={f.stop} onChange={set('stop')} /><input placeholder="target" value={f.target} onChange={set('target')} />
      <select value={f.result} onChange={set('result')}>{['open', 'win', 'loss', 'breakeven'].map(r => <option key={r}>{r}</option>)}</select>
      <input placeholder="strategy" value={f.strategy} onChange={set('strategy')} /><input placeholder="notes" value={f.notes} onChange={set('notes')} /><input placeholder="lessons" value={f.lessons} onChange={set('lessons')} />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">Screenshot <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); }} /></label>
      {shot && <img src={shot} alt="Screenshot preview" className="h-16 rounded border border-border" />}
      <button onClick={save}>Add entry</button></div>
    <small style={{ color: '#e06c6c' }}>{err}</small>
    <pre>Entries {stats.total} | Closed {stats.closed} (W {stats.wins} / L {stats.losses} / BE {stats.be}) | Win rate {stats.winRate === null ? '-' : stats.winRate.toFixed(1) + '%'} | Total R {stats.totalR.toFixed(2)} | Avg R {stats.avgR === null ? '-' : stats.avgR.toFixed(2)} | Max win streak {stats.mw} | Max loss streak {stats.ml}{'\n'}Waiting for entry {stats.waiting} | Never filled {stats.missed}{'\n'}Statistics come only from your own records. Auto signals use their measured R; manual wins are counted at the planned target, so actual R may differ. See the Performance tab for the full report.</pre>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Date', 'Market', 'Dir', 'Entry', 'SL', 'TP', 'Result', 'Status', 'R', 'Strategy', 'Notes / lessons', 'Chart', ''].map(h => <th key={h} align="left">{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => { const x = r.result === 'open' || r.result === 'missed' ? null : realizedR(r); return <tr key={r.id}>
        <td>{new Date(r.createdAt).toLocaleString()}</td><td>{nameOf(r.symbol)}</td><td>{r.direction}</td><td>{r.entry}</td><td>{r.stop ?? '-'}</td><td>{r.target ?? '-'}</td>
        <td><select value={r.result ?? 'open'} onChange={e => send('PATCH', `/api/journal/${r.id}`, { result: e.target.value }).then(load).catch(fail)}>{RESULTS.map(o => <option key={o}>{o}</option>)}</select></td>
        <td><small>{status(r)}</small></td><td>{x === null ? '-' : x.toFixed(2)}</td><td>{r.strategy}</td><td>{[r.notes, r.lessons].filter(Boolean).join(' | ')}</td>
        <td><Shot entry={r} onChange={load} onError={fail} /></td>
        <td><button onClick={() => confirm('Delete this entry?') && send('DELETE', `/api/journal/${r.id}`).then(load).catch(fail)}>delete</button></td></tr>; })}</tbody></table>
  </div>;
}
