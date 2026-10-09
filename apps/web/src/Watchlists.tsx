import { useEffect, useState } from 'react';
import { send } from './api';

export function Watchlists({ onOpen }: { onOpen: (s: string) => void }) {
  const [lists, setLists] = useState<any[]>([]), [inst, setInst] = useState<any[]>([]), [sel, setSel] = useState(''), [name, setName] = useState('');
  const [add, setAdd] = useState(''), [cond, setCond] = useState<Record<string, any>>({}), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const fail = (e: any) => setErr(e.message ?? 'Something went wrong');
  const load = () => send('GET', '/api/watchlists').then((l: any[]) => { setErr(''); setLists(l); setSel(s => l.some(x => x.id === s) ? s : l.find(x => x.isDefault)?.id ?? l[0]?.id ?? ''); }).catch(fail);
  useEffect(() => { load(); send('GET', '/api/instruments').then(setInst).catch(() => {}); }, []);
  const cur = lists.find(l => l.id === sel), syms: string[] = cur?.symbols ?? [];
  const patch = (id: string, body: object) => send('PATCH', `/api/watchlists/${id}`, body).then(load).catch(fail);
  const create = () => { if (!name.trim()) return; send('POST', '/api/watchlists', { name: name.trim(), symbols: [], isDefault: lists.length === 0 }).then(r => { setName(''); setSel(r.id); return load(); }).catch(fail); };
  const makeDefault = async () => { for (const l of lists) if (l.isDefault && l.id !== cur.id) await send('PATCH', `/api/watchlists/${l.id}`, { isDefault: false }).catch(fail); patch(cur.id, { isDefault: true }); };
  const rename = () => { const n = prompt('Rename watchlist', cur.name)?.trim(); if (n) patch(cur.id, { name: n }); };
  const del = () => { if (confirm(`Delete "${cur.name}"?`)) send('DELETE', `/api/watchlists/${cur.id}`).then(load).catch(fail); };
  const move = (i: number, d: number) => { const s = [...syms], k = i + d; if (k < 0 || k >= s.length) return; [s[i], s[k]] = [s[k], s[i]]; patch(cur.id, { symbols: s }); };
  const addSym = () => { if (add && !syms.includes(add)) patch(cur.id, { symbols: [...syms, add] }).then(() => setAdd('')); };
  const refresh = () => { setBusy(true); send('GET', '/api/scanner?tf=15m').then(j => setCond(Object.fromEntries(j.rows.map((r: any) => [r.symbol, r])))).catch(fail).finally(() => setBusy(false)); };
  const nameOf = (s: string) => inst.find(i => i.symbol === s)?.name ?? s;
  return <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
    <div><b>Watchlists</b>
      {lists.map(l => <div key={l.id}><button onClick={() => setSel(l.id)} style={{ fontWeight: l.id === sel ? 700 : 400 }}>{l.name}{l.isDefault ? ' (default)' : ''}</button></div>)}
      <div style={{ marginTop: 8 }}><input placeholder="new watchlist" value={name} onChange={e => setName(e.target.value)} size={14} /> <button onClick={create}>Create</button></div>
      <small style={{ color: '#e06c6c' }}>{err}</small></div>
    {cur ? <div>
      <div><b>{cur.name}</b> <button onClick={rename}>Rename</button> <button onClick={makeDefault} disabled={cur.isDefault}>Set default</button> <button onClick={del}>Delete</button></div>
      <div style={{ margin: '8px 0' }}><select value={add} onChange={e => setAdd(e.target.value)}><option value="">Add market...</option>{inst.filter(i => !syms.includes(i.symbol)).map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select> <button onClick={addSym}>Add</button>{' '}
        <button onClick={refresh} disabled={busy}>{busy ? 'Loading...' : 'Refresh conditions (15m)'}</button></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Market', 'Bias', 'Structure', 'Confluence', ''].map(h => <th key={h} align="left">{h}</th>)}</tr></thead>
        <tbody>{syms.map((s, i) => { const c = cond[s]; return <tr key={s}><td><a href="#" onClick={e => { e.preventDefault(); onOpen(s); }}>{nameOf(s)}</a></td><td>{c?.bias ?? '-'}</td><td>{c?.structure ?? '-'}</td><td>{c?.confluenceScore ?? '-'}</td>
          <td><button onClick={() => move(i, -1)}>up</button> <button onClick={() => move(i, 1)}>down</button> <button onClick={() => patch(cur.id, { symbols: syms.filter(x => x !== s) })}>remove</button></td></tr>; })}</tbody></table>
      {!syms.length && <small>No markets yet.</small>}
    </div> : <small>Create a watchlist to get started.</small>}
  </div>;
}
