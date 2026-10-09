import { useEffect, useState } from 'react';
import { prefs, send } from './api';
import { Button } from '@/components/ui/button';

export function Settings() {
  const [p, setP] = useState<any>(null), [inst, setInst] = useState<any[]>([]), [msg, setMsg] = useState('');
  useEffect(() => { send('GET', '/api/preferences').then(setP).catch(e => setMsg(e.message)); send('GET', '/api/instruments').then(setInst).catch(() => {}); }, []);
  if (!p) return <div className="p-4"><small>{msg || 'Loading...'}</small></div>;
  const set = (k: string, num = false) => (e: any) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : num ? +e.target.value : e.target.value });
  const save = () => send('PUT', '/api/preferences', p).then(r => { setP(r); prefs.defaultTf = r.defaultTf; prefs.notifications = r.notifications; setMsg('Saved. Reload data views to apply the new swing sensitivity.'); }).catch(e => setMsg(e.message));
  const Row = ({ label, hint, children }: any) => <div className="grid grid-cols-[200px_1fr] items-start gap-3 py-2"><div>{label}</div><div className="space-y-1">{children}{hint && <small className="block">{hint}</small>}</div></div>;
  return <div className="max-w-2xl space-y-1 p-4"><b>Settings</b>
    <Row label="Swing sensitivity" hint="Candles on each side a high/low needs to count as a swing (2 = more, smaller swings; 6 = fewer, larger swings). Applies to charts, market pages, history, scanner, overview and AI answers. Alerts and backtests always use 3/3.">
      <div className="flex items-center gap-2">Left <select value={p.swingLeft} onChange={set('swingLeft', true)}>{[2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select> Right <select value={p.swingRight} onChange={set('swingRight', true)}>{[2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></div></Row>
    <Row label="Default timeframe"><select value={p.defaultTf} onChange={set('defaultTf')}>{['1m', '2m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map(t => <option key={t}>{t}</option>)}</select></Row>
    <Row label="Default market"><select value={p.defaultSymbol} onChange={set('defaultSymbol')}><option value="">First available</option>{inst.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select></Row>
    <Row label="Browser notifications" hint="Show a browser notification when an alert fires."><label className="flex items-center gap-2"><input type="checkbox" checked={p.notifications} onChange={set('notifications')} />Enabled</label>
      {'Notification' in window && Notification.permission !== 'granted' && <Button size="sm" onClick={() => Notification.requestPermission()}>Allow in browser</Button>}</Row>
    <div className="flex items-center gap-3 pt-2"><Button variant="default" onClick={save}>Save settings</Button><small>{msg}</small></div></div>;
}
