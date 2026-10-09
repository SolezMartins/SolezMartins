import './index.css';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { auth, liveSocket, prefs, send } from './api';
import { Watchlists } from './Watchlists';
import { MarketsPage } from './Markets';
import { Journal } from './Journal';
import { Performance } from './Performance';
import { Reports } from './Reports';
import { History } from './History';
import { Backtest } from './Backtest';
import { Analyst } from './Analyst';
import { Scanner as ScannerPage } from './ScannerPage';
import { Alerts } from './Alerts';
import { Settings } from './Settings';
import { Overview } from './Overview';
import { Login, NewPassword } from './Login';
import { Sidebar } from './Sidebar';
import { BarChart3, Bot, BookOpen, FileText, FlaskConical, History as HistoryIcon, Globe, LayoutDashboard, ListChecks, Bell, Search, Settings as SettingsIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createChart, type UTCTimestamp } from 'lightweight-charts';

const SB_URL = import.meta.env.VITE_SUPABASE_URL, SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;
const _fetch = window.fetch.bind(window);
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, ''); // empty = same origin (dev proxy); set to the deployed API origin on Vercel
window.fetch = (u: any, i?: any) => {
  const isApi = typeof u === 'string' && u.startsWith('/api');
  return _fetch(isApi ? API + u : u, isApi && auth.token ? { ...i, headers: { ...(i?.headers ?? {}), Authorization: `Bearer ${auth.token}` } } : i);
};

const NAV = [['dashboard', 'Dashboard', LayoutDashboard], ['markets', 'Markets', Globe], ['scanner', 'Scanner', Search], ['history', 'History', HistoryIcon], ['watchlists', 'Watchlists', ListChecks], ['alerts', 'Alerts', Bell], ['analyst', 'AI Analyst', Bot], ['journal', 'Journal', BookOpen], ['performance', 'Performance', BarChart3], ['reports', 'Reports', FileText], ['backtest', 'Backtesting', FlaskConical], ['settings', 'Settings', SettingsIcon]] as const;
type Tab = typeof NAV[number][0];
function useStatus() {
  const [s, setS] = useState<any>({});
  useEffect(() => { const t = () => fetch('/api/status').then(r => r.json()).then(setS).catch(() => setS({ feed: 'DISCONNECTED' })); t(); const i = setInterval(t, 3000); return () => clearInterval(i); }, []);
  return s;
}
function Shell() {
  const [tab, setTab] = useState<Tab>('dashboard'), [sym, setSym] = useState('R_75'), [market, setMarket] = useState<string | null>(null), st = useStatus(), feed: string = st.feed ?? '...';
  const [ready, setReady] = useState(false);
  useEffect(() => { send('GET', '/api/preferences').then(p => { prefs.defaultTf = p.defaultTf; prefs.notifications = p.notifications; if (p.defaultSymbol) setSym(p.defaultSymbol); }).catch(() => {}).finally(() => setReady(true)); }, []);
  const [alerts, setAlerts] = useState<string[]>([]), [stream, setStream] = useState<'open' | 'reconnecting'>('reconnecting');
  useEffect(() => liveSocket(null, null, m => { // app-wide alerts socket: alerts arrive on every tab
    if (m.type !== 'alert') return; const t = m.text ?? `${m.alert.symbol} ${m.alert.kind} @ ${m.price}`; setAlerts(p => [t, ...p].slice(0, 20));
    if (prefs.notifications && 'Notification' in window && Notification.permission === 'granted') new Notification(t);
  }, s => setStream(s)), []);
  useEffect(() => { // /markets/<slug> deep links and back/forward
    const parse = () => { const m = location.pathname.match(/^\/markets\/([a-z0-9-]+)$/); if (m) { setTab('markets'); setMarket(m[1]); } else setMarket(null); };
    parse(); addEventListener('popstate', parse); return () => removeEventListener('popstate', parse);
  }, []);
  const openMarket = (slug: string | null) => { setTab('markets'); setMarket(slug); history.pushState(null, '', slug ? `/markets/${slug}` : '/'); };
  const [email, setEmail] = useState<string | null>(null), [seen, setSeen] = useState(0);
  useEffect(() => { supabase?.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null)).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'alerts') setSeen(alerts.length); }, [tab, alerts.length]);
  const pick = (id: string) => { setTab(id as Tab); if (id === 'markets') openMarket(null); else history.replaceState(null, '', '/'); };
  return <div className="flex h-screen gap-3 p-3">
    <Sidebar items={NAV} active={tab} onSelect={pick} email={email} badges={{ alerts: Math.max(0, alerts.length - seen) }} onSignOut={supabase ? () => supabase.auth.signOut() : undefined}
      groups={[{ label: '', ids: NAV.map(n => n[0]) }]} />
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <header className="glass flex h-12 shrink-0 items-center justify-end gap-2 rounded-2xl px-4">
        {stream !== 'open' && <Badge tone="warn">Browser stream reconnecting...</Badge>}
        {feed === 'DISCONNECTED' && <small>Attempting to reconnect...</small>}
        <Badge tone={feed === 'LIVE' ? 'bull' : feed === 'DATA DELAYED' ? 'warn' : feed === '...' ? 'neutral' : 'bear'}><span className="h-1.5 w-1.5 rounded-full bg-current" />{feed}{feed !== 'DISCONNECTED' && feed !== '...' && st.lastUpdateMs != null ? ` · ${(st.lastUpdateMs / 1000).toFixed(1)}s` : ''}</Badge>
        <Badge tone={st.ai === 'available' ? 'bull' : 'neutral'}>AI Analyst · {st.ai === 'available' ? 'Available' : 'Offline'}</Badge>
      </header>
      <main className="glass min-h-0 flex-1 overflow-auto rounded-2xl">{!ready ? <div className="p-4"><small>Loading...</small></div> : <>
        {tab === 'dashboard' && <App sym={sym} setSym={setSym} alerts={alerts} />}
        {tab === 'markets' && <MarketsPage slug={market} onOpen={openMarket} onHistory={s => { setSym(s); setTab('history'); history.replaceState(null, '', '/'); }} />}
        {tab === 'history' && <History sym={sym} setSym={setSym} />}
        {tab === 'scanner' && <ScannerPage onOpen={openMarket} />}
        {tab === 'alerts' && <Alerts recent={alerts} />}
        {tab === 'settings' && <Settings />}
        {tab === 'backtest' && <Backtest sym={sym} setSym={setSym} />}
        {tab === 'watchlists' && <Watchlists onOpen={s => { setSym(s); setTab('dashboard'); }} />}
        {tab === 'analyst' && <Analyst sym={sym} />}
        {tab === 'journal' && <Journal />}
        {tab === 'performance' && <Performance />}
        {tab === 'reports' && <Reports />}
      </>}</main>
    </div>
  </div>;
}
function Root() {
  const [ready, setReady] = useState(!supabase), [signed, setSigned] = useState(!supabase), [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const t = setTimeout(() => setReady(true), 8000); // never stay blank if Supabase is slow or unreachable: fall through to the login screen
    supabase.auth.getSession().then(({ data }) => { auth.token = data.session?.access_token ?? ''; setSigned(!!data.session); }).catch(err => console.error('Supabase session check failed', err)).finally(() => { clearTimeout(t); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setRecovering(true); auth.token = s?.access_token ?? ''; setSigned(!!s); });
    return () => sub.subscription.unsubscribe();
  }, []);
  return !ready ? null : supabase && recovering ? <NewPassword supabase={supabase} done={() => setRecovering(false)} /> : signed ? <Shell /> : <Login supabase={supabase!} />;
}
function Scanner({ tf, onPick }: { tf: string; onPick: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  const run = () => { setBusy(true); send('GET', `/api/scanner?tf=${tf}`).then(j => setRows(Array.isArray(j?.rows) ? j.rows : [])).catch(() => setRows([])).finally(() => setBusy(false)); };
  return <div style={{ marginTop: 16 }}><button onClick={run} disabled={busy}>{busy ? 'Scanning...' : 'Run scanner'}</button>
    <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}><thead><tr>{['Market','Bias','Structure','Momentum','Sweep','FVG','Confluence'].map(h => <th key={h} align="left">{h}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.symbol} onClick={() => onPick(r.symbol)} style={{ cursor: 'pointer' }}><td>{r.name}</td><td>{r.bias}</td><td>{r.structure}</td><td>{r.momentum}</td><td>{r.liquiditySweep ? 'yes' : '-'}</td><td>{r.fvg ? 'yes' : '-'}</td><td>{r.confluenceScore}</td></tr>)}</tbody></table></div>;
}
function App({ sym, setSym, alerts }: { sym: string; setSym: (s: string) => void; alerts: string[] }) {
  const [list, setList] = useState<any[]>([]); const [tf, setTf] = useState(prefs.defaultTf);
  const [err, setErr] = useState(''), [a, setA] = useState<any>(null); const [status, setStatus] = useState<any>({}); const [ai, setAi] = useState(''); const series = useRef<any>(null); const [reload, setReload] = useState(0); const [lvl, setLvl] = useState(''); const [kind, setKind] = useState('price_above');
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { send('GET', '/api/instruments').then(l => setList(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  useEffect(() => { setErr(''); send('GET', `/api/analysis/${sym}?tf=${tf}`).then(d => setA(Array.isArray(d?.candles) ? d : null)).catch(e => { setA(null); setErr(e.message); }); }, [sym, tf, reload]);
  useEffect(() => {
    if (!a || !el.current) return;
    const chart = createChart(el.current, { height: 460, layout: { background: { color: 'transparent' }, textColor: '#9aa3b5' }, grid: { vertLines: { color: 'rgba(255,255,255,.04)' }, horzLines: { color: 'rgba(255,255,255,.04)' } } });
    series.current = chart.addCandlestickSeries(); series.current.setData(a.candles.map((c: any) => ({ ...c, time: c.time as UTCTimestamp })));
    return () => chart.remove();
  }, [a]);
  useEffect(() => liveSocket(sym, tf, m => { if (m.type === 'candle' && m.symbol === sym && m.tf === tf) series.current?.update({ ...m.candle, time: m.candle.time as UTCTimestamp }); },
    (st, again) => { if (st === 'open' && again) setReload(n => n + 1); }), [sym, tf]); // refetch after a reconnect to fill missed candles
  const addAlert = () => { Notification.requestPermission(); const body = kind.startsWith('price_') ? { kind: 'price_level', dir: kind.slice(6) } : kind.startsWith('rsi_') ? { kind: 'rsi', dir: kind.slice(4) } : { kind };
    fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, tf, level: lvl ? +lvl : undefined, ...body }) }); };
  const [wl, setWl] = useState<any>(null);
  useEffect(() => { send('GET', '/api/watchlists').then(l => setWl(Array.isArray(l) ? l.find((x: any) => x.isDefault) ?? null : null)).catch(() => {}); }, []);
  const addToWl = () => wl && !(wl.symbols ?? []).includes(sym) && fetch(`/api/watchlists/${wl.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: [...(wl.symbols ?? []), sym] }) }).then(r => r.json()).then(setWl);
  const s = a?.snapshot;
  return <div style={{ padding: 16 }}>
    <select value={sym} onChange={e => setSym(e.target.value)}>{list.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select>{' '}
    <select value={tf} onChange={e => setTf(e.target.value)}>{['1m','2m','5m','15m','30m','1h','2h','4h','1d'].map(t => <option key={t}>{t}</option>)}</select>
    {err && <div className="my-2 text-sm text-red-400">Could not load {sym}: {err}</div>}
    <Overview tf={tf} />
    {wl && <div style={{ marginTop: 8 }}>{wl.name}: {(wl.symbols ?? []).map((x: string) => <button key={x} onClick={() => setSym(x)} style={{ fontWeight: x === sym ? 700 : 400 }}>{x}</button>)} <button onClick={addToWl}>+ {sym}</button></div>}
    <div ref={el} style={{ margin: '12px 0' }} />
    {s && <div className="my-2 flex items-center gap-2"><Badge tone={s.bias.includes('bull') ? 'bull' : s.bias.includes('bear') ? 'bear' : 'neutral'}>{s.bias.replace('_', ' ')}</Badge><Badge>Confluence {s.confluenceScore}/100</Badge></div>}
    {s && <pre>Bias: {s.bias} | Structure: {s.structure} | Momentum: {s.momentum} | RSI: {s.rsi}{'\n'}EMA: {s.emaAlignment} | Sweep: {String(s.liquiditySweep)} | FVG: {String(s.fvg)}{'\n'}Technical confluence: {s.confluenceScore}/100 (not a win probability){'\n'}Support: {s.support.join(', ')} | Resistance: {s.resistance.join(', ')}</pre>}
    <button onClick={() => fetch('/api/ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, tf }) }).then(r => r.json()).then(j => setAi(j.explanation ?? j.notice))}>AI explain</button>
    <p style={{ whiteSpace: 'pre-wrap' }}>{ai}</p>
    <div style={{ marginTop: 8 }}><select value={kind} onChange={e => setKind(e.target.value)}>{['price_above', 'price_below', 'bos', 'choch', 'sweep', 'fvg', 'fvg_filled', 'enter_demand', 'enter_supply', 'ema_cross', 'rsi_above', 'rsi_below', 'confluence'].map(k => <option key={k}>{k}</option>)}</select>{' '}
      <input placeholder="level" value={lvl} onChange={e => setLvl(e.target.value)} size={8} /> <button onClick={addAlert}>Add alert</button> <small>Fires once, on a new event or a level crossing.</small>{alerts.map((x, i) => <div key={i}>{x}</div>)}</div>
    <Scanner tf={tf} onPick={setSym} />
    <small>Analysis only. No trades are executed. Not financial advice.</small>
  </div>;
}
class Boundary extends React.Component<{ children: React.ReactNode }, { err?: Error }> { // a crash shows a message instead of a blank page
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { return this.state.err ? <div className="mx-auto mt-16 max-w-md p-4"><b>Something went wrong.</b><p className="my-2 text-sm">{this.state.err.message}</p><button onClick={() => location.reload()}>Reload</button></div> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<Boundary><Root /></Boundary>);
