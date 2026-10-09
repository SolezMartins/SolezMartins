import { useEffect, useState } from 'react';
import { send } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const KINDS: [string, string, boolean][] = [['price_above', 'Price crosses above', true], ['price_below', 'Price crosses below', true], ['rsi_above', 'RSI crosses above', true], ['rsi_below', 'RSI crosses below', true], ['confluence', 'Confluence crosses up through', true], ['signal', 'Trade signal → Journal (min confluence, e.g. 70)', true], ['smc_signal', 'SMC signal → Journal (level 1 = require HTF agreement, 0 = not)', true],
  ['bos', 'BOS on candle close', false], ['choch', 'CHOCH on candle close', false], ['sweep', 'Liquidity sweep on candle close', false], ['fvg', 'FVG created', false], ['fvg_filled', 'FVG filled', false], ['enter_demand', 'Price enters demand zone', false], ['enter_supply', 'Price enters supply zone', false], ['ema_cross', 'EMA 20/50 cross', false],
  ['scenario_in_zone', 'Scenario: price enters the entry zone', false], ['scenario_invalidated', 'Scenario: invalidated (price beyond the stop)', false], ['scenario_target', 'Scenario: Target 1 already reached', false]];
const EVENT = ['bos', 'choch', 'sweep', 'fvg', 'ema_cross', 'scenario_in_zone', 'scenario_invalidated', 'scenario_target'], key = (a: any) => a.kind === 'price_level' ? `price_${a.dir === 'below' ? 'below' : 'above'}` : a.kind === 'rsi' ? `rsi_${a.dir}` : a.kind;
const describe = (a: any) => { const l = KINDS.find(k => k[0] === key(a)); return `${l?.[1] ?? a.kind}${a.level != null ? ` ${a.level}` : ''}${a.dir && EVENT.includes(a.kind) ? ` (${a.dir} only)` : ''}`; };
export function Alerts({ recent }: { recent: string[] }) {
  const [list, setList] = useState<any[]>([]), [inst, setInst] = useState<any[]>([]), [err, setErr] = useState(''), [f, setF] = useState({ symbol: '', tf: '15m', kind: 'price_above', level: '', dir: '' });
  const fail = (e: any) => setErr(e.message ?? 'Something went wrong');
  const load = () => send('GET', '/api/alerts').then((l: any[]) => { setErr(''); setList(l.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))); }).catch(fail);
  useEffect(() => { load(); send('GET', '/api/instruments').then(setInst).catch(() => {}); const t = setInterval(load, 10_000); return () => clearInterval(t); }, []);
  const needsLevel = KINDS.find(k => k[0] === f.kind)![2], set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const create = () => {
    if (!f.symbol) return setErr('Choose a market.'); if (needsLevel && !Number.isFinite(parseFloat(f.level))) return setErr('Enter a level.');
    const body: any = f.kind.startsWith('price_') ? { kind: 'price_level', dir: f.kind.slice(6) } : f.kind.startsWith('rsi_') ? { kind: 'rsi', dir: f.kind.slice(4) } : { kind: f.kind, ...(EVENT.includes(f.kind) && f.dir ? { dir: f.dir } : {}) };
    send('POST', '/api/alerts', { symbol: f.symbol, tf: f.tf, ...body, ...(needsLevel ? { level: parseFloat(f.level) } : {}) }).then(() => { setF({ ...f, level: '' }); return load(); }).catch(fail);
  };
  const patch = (id: string, b: object) => send('PATCH', `/api/alerts/${id}`, b).then(load).catch(fail), name = (s: string) => inst.find(i => i.symbol === s)?.name ?? s;
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center gap-2"><b>Alerts</b><small>Analytical only. Alerts never place trades. Each fires once, on a new event, a crossing or a scenario status change; re-arm to use it again.</small>
      {'Notification' in window && Notification.permission !== 'granted' && <Button size="sm" onClick={() => Notification.requestPermission()}>Enable browser notifications</Button>}</div>
    <div className="flex flex-wrap items-center gap-2">
      <select value={f.symbol} onChange={set('symbol')}><option value="">Market...</option>{inst.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select>
      <select value={f.tf} onChange={set('tf')}>{['1m', '2m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map(t => <option key={t}>{t}</option>)}</select>
      <select value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {needsLevel && <input placeholder="level" value={f.level} onChange={set('level')} className="w-24" />}
      {EVENT.includes(f.kind) && <select value={f.dir} onChange={set('dir')}><option value="">Any direction</option><option value="bullish">Bullish only</option><option value="bearish">Bearish only</option></select>}
      <Button variant="default" onClick={create}>Create alert</Button><small className="text-bear">{err}</small></div>
    <table><thead><tr>{['Market', 'TF', 'Alert', 'Status', 'Last triggered', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{list.map(a => <tr key={a.id}><td>{name(a.symbol)}</td><td>{a.tf ?? '-'}</td><td>{describe(a)}</td><td><Badge tone={a.active ? 'bull' : 'neutral'}>{a.active ? 'active' : a.triggeredAt ? 'triggered' : 'paused'}</Badge></td>
        <td>{a.triggeredAt ? new Date(a.triggeredAt).toLocaleString() : '-'}</td>
        <td><button onClick={() => patch(a.id, { active: !a.active })}>{a.active ? 'Pause' : 'Re-arm'}</button> <button onClick={() => confirm('Delete this alert?') && send('DELETE', `/api/alerts/${a.id}`).then(load).catch(fail)}>Delete</button></td></tr>)}</tbody></table>
    {!list.length && <small>No alerts yet.</small>}
    {!!recent.length && <div><b>This session</b>{recent.map((r, i) => <div key={i} className="text-xs text-muted-foreground">{r}</div>)}</div>}
    <small>Alerts are evaluated only for markets the server is streaming, which includes every market with an active alert. They use the default swing sensitivity (3/3).</small>
  </div>;
}
