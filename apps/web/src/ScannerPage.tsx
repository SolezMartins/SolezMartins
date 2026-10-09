import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, RefreshCw } from 'lucide-react';
import { prefs, send } from './api';
import { scenarioView, SCENARIO_OPTIONS, smcView, SMC_OPTIONS } from './scenarioStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const BIAS = ['strong_bullish', 'bullish', 'neutral', 'bearish', 'strong_bearish'];
const COLS: [string, string][] = [['name', 'Market'], ['category', 'Category'], ['bias', 'Bias'], ['htfStructure', 'HTF'], ['structure', 'Structure'], ['momentum', 'Momentum'], ['volatility', 'Volatility'], ['liquiditySweep', 'Sweep'], ['fvg', 'FVG'], ['zone', 'Zone'], ['scenarioRank', 'Scenario'], ['smcRank', 'SMC'], ['distAtr', 'Dist (ATR)'], ['rr', 'R:R (plan)'], ['confluenceScore', 'Confluence']];
const blank = { category: '', bias: '', structure: '', htf: '', momentum: '', volatility: '', sweep: '', fvg: '', zone: '', scenario: '', scnDir: '', smc: '', smcDir: '', smcOk: false, minScore: 0, q: '' };
const tone = (b: string) => b.includes('bull') ? 'bull' : b.includes('bear') ? 'bear' : 'neutral';
const REFRESH = [['0', 'Auto-refresh off'], ['60', 'Every 1 min'], ['120', 'Every 2 min'], ['300', 'Every 5 min']];
const PRESETS_KEY = 'dmi.scanner.presets';
type Preset = { name: string; tf: string; f: typeof blank };
// Presets live in this browser (localStorage), not in your account. Storage can be blocked or full, so every access is guarded.
const loadPresets = (): Preset[] => { try { const v = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]'); return Array.isArray(v) ? v.filter(p => p && typeof p.name === 'string' && p.f) : []; } catch { return []; } };
const storePresets = (p: Preset[]) => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); return true; } catch { return false; } };
/** CSV cell: quoted, quotes doubled, and a leading = + - @ neutralised so spreadsheets never run it as a formula. */
const cell = (v: unknown) => { let t = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };

/** Research tool: shows technical conditions across all markets. It does not rank "best trades". */
export function Scanner({ onOpen }: { onOpen: (slug: string) => void }) {
  const [tf, setTf] = useState(prefs.defaultTf), [rows, setRows] = useState<any[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [at, setAt] = useState(0);
  const [f, setF] = useState<any>(blank), [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: 'confluenceScore', d: -1 });
  const [auto, setAuto] = useState('0'), [presets, setPresets] = useState<Preset[]>(loadPresets), [pick, setPick] = useState('');
  const run = () => { setBusy(true); setErr(''); send('GET', `/api/scanner?tf=${tf}`).then(j => { setRows(j.rows); setAt(Date.now()); }).catch(e => setErr(e.message)).finally(() => setBusy(false)); };
  // Auto-refresh re-runs the scan on a timer (the server caches each market for 60 s, so intervals under a minute would do nothing). Skips a tick while a scan is still running or the tab is hidden.
  const runRef = useRef(run), busyRef = useRef(busy); runRef.current = run; busyRef.current = busy;
  useEffect(() => { const sec = +auto; if (!sec) return; const t = setInterval(() => { if (!busyRef.current && !document.hidden) runRef.current(); }, sec * 1000); return () => clearInterval(t); }, [auto, tf]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: k === 'minScore' ? +e.target.value : e.target.value });
  // Scenario status per row: same liveEntry() logic as the market page's "Potential scenario" card, evaluated at the scan's last close.
  const enriched = useMemo(() => rows.map(r => { const v = scenarioView(r.scenario, r.price); return { ...r, scn: v, scenarioRank: v.rank, distAtr: v.distanceAtr, rr: v.rr, scnDir: r.scenario?.direction ?? '', sm: smcView(r.smc, r.price), smcRank: smcView(r.smc, r.price).rank }; }), [rows]);
  const view = useMemo(() => {
    const val = (r: any, k: string) => k === 'bias' ? BIAS.indexOf(r.bias) : r[k] ?? (k === 'distAtr' || k === 'rr' ? -1 : '');
    return enriched.filter(r => (!f.category || r.category === f.category) && (!f.bias || r.bias.includes(f.bias)) && (!f.structure || r.structure === f.structure) && (!f.htf || r.htfStructure === f.htf) && (!f.momentum || r.momentum === f.momentum)
      && (!f.volatility || r.volatility === f.volatility) && (!f.sweep || r.liquiditySweep) && (!f.fvg || r.fvg) && (!f.zone || r.zone === f.zone) && (!f.scenario || r.scn.key === f.scenario) && (!f.scnDir || r.scnDir === f.scnDir) && (!f.smc || r.sm.key === f.smc) && (!f.smcDir || r.sm.direction === f.smcDir) && (!f.smcOk || r.sm.ok) && r.confluenceScore >= f.minScore && (!f.q || r.name.toLowerCase().includes(f.q.toLowerCase())))
      .sort((a, b) => { const x = val(a, sort.k), y = val(b, sort.k); return (x < y ? -1 : x > y ? 1 : 0) * sort.d; });
  }, [enriched, f, sort]);
  const Sel = ({ k, label, opts }: { k: string; label: string; opts: string[] }) => <select value={f[k]} onChange={set(k)}><option value="">{label}</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  const savePreset = () => {
    const name = (prompt('Name this filter preset (saved in this browser):') ?? '').trim().slice(0, 40); if (!name) return;
    const next = [...presets.filter(p => p.name !== name), { name, tf, f }].slice(-20); if (!storePresets(next)) return setErr('Could not save: this browser is blocking local storage.');
    setPresets(next); setPick(name); setErr('');
  };
  const applyPreset = (name: string) => { setPick(name); const p = presets.find(x => x.name === name); if (p) { setF({ ...blank, ...p.f }); if (p.tf !== tf) { setTf(p.tf); setRows([]); } } };
  const deletePreset = () => { if (!pick || !confirm(`Delete preset "${pick}"?`)) return; const next = presets.filter(p => p.name !== pick); storePresets(next); setPresets(next); setPick(''); };
  const exportCsv = () => {
    const head = ['Market', 'Category', 'Bias', 'HTF', 'Structure', 'Momentum', 'Volatility', 'Sweep', 'FVG', 'Near zone', 'Scenario direction', 'Scenario status', 'Distance to zone (ATR)', 'Planned R:R', 'SMC direction', 'SMC status', 'SMC checks pass', 'Confluence', 'Price', 'Timeframe', 'Scanned at'];
    const lines = view.map(r => [r.name, r.category, r.bias, r.htfStructure, r.structure, r.momentum, r.volatility, r.liquiditySweep ? 'yes' : '', r.fvg ? 'yes' : '', r.zone ?? '', r.scnDir, r.scn.label, r.distAtr == null ? '' : r.distAtr.toFixed(2), r.rr == null ? '' : r.rr.toFixed(2), r.sm.direction, r.sm.label, r.sm.ok ? 'yes' : '', r.confluenceScore, r.price, tf, new Date(at).toISOString()].map(cell).join(','));
    const url = URL.createObjectURL(new Blob(['\ufeff' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `scanner-${tf}-${new Date(at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-2"><b>Scanner</b><small>Research tool: technical conditions across all markets, not trade recommendations.</small></div>
    <div className="flex flex-wrap items-center gap-2">
      <select value={tf} onChange={e => setTf(e.target.value)}>{['1m', '2m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map(t => <option key={t}>{t}</option>)}</select>
      <Button variant="default" onClick={run} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />{busy ? 'Scanning...' : rows.length ? 'Rescan' : 'Scan'}</Button>
      <select value={auto} onChange={e => setAuto(e.target.value)} title="Re-runs the scan automatically while this page is open and visible">{REFRESH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {!!rows.length && <Button size="sm" variant="secondary" onClick={exportCsv} title="Download the rows currently shown (after filters) as CSV"><Download className="h-3.5 w-3.5" />Export CSV</Button>}
      {at > 0 && <small>{rows.length} markets analysed at {new Date(at).toLocaleTimeString()}; showing {view.length}</small>}<small className="text-bear">{err}</small></div>
    <div className="flex flex-wrap items-center gap-2"><small>Presets</small>
      <select value={pick} onChange={e => applyPreset(e.target.value)}><option value="">{presets.length ? 'Apply a saved preset...' : 'No saved presets'}</option>{presets.map(p => <option key={p.name}>{p.name}</option>)}</select>
      <Button size="sm" variant="secondary" onClick={savePreset}>Save current filters</Button>{!!pick && <Button size="sm" variant="ghost" onClick={deletePreset}>Delete preset</Button>}</div>
    {!!rows.length && <div className="flex flex-wrap items-center gap-2">
      <input placeholder="Search" value={f.q} onChange={set('q')} className="w-36" />
      <Sel k="category" label="Category" opts={[...new Set<string>(rows.map((r: any) => r.category))]} /><Sel k="bias" label="Bias" opts={['bullish', 'bearish', 'neutral']} /><Sel k="htf" label="HTF" opts={['bullish', 'bearish', 'range']} />
      <Sel k="structure" label="Structure" opts={['bullish', 'bearish', 'range']} /><Sel k="momentum" label="Momentum" opts={['positive', 'negative']} /><Sel k="volatility" label="Volatility" opts={['expanding', 'normal', 'contracting']} />
      <Sel k="sweep" label="Sweep" opts={['yes']} /><Sel k="fvg" label="FVG" opts={['yes']} /><Sel k="zone" label="Near zone" opts={['demand', 'supply']} />
      <select value={f.scenario} onChange={set('scenario')} title="Status of each market's potential scenario at the latest price"><option value="">Scenario status</option>{SCENARIO_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      <select value={f.scnDir} onChange={set('scnDir')} title="Direction of each market's potential scenario"><option value="">Scenario direction</option><option value="bullish">Bullish scenario</option><option value="bearish">Bearish scenario</option></select>
      <select value={f.smc} onChange={set('smc')} title="Status of each market's SMC setup (sweep, structure shift, order block) at the latest price"><option value="">SMC status</option>{SMC_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      <select value={f.smcDir} onChange={set('smcDir')} title="Direction of each market's SMC setup"><option value="">SMC direction</option><option value="bullish">Bullish SMC</option><option value="bearish">Bearish SMC</option></select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Only setups where every SMC check passes (discount/premium, R:R at least 1.5, zone untouched)"><input type="checkbox" checked={!!f.smcOk} onChange={e => setF({ ...f, smcOk: e.target.checked })} />SMC checks pass</label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Min confluence <input type="number" min={0} max={100} value={f.minScore} onChange={set('minScore')} className="w-16" /></label>
      <Button size="sm" variant="ghost" onClick={() => { setF(blank); setPick(''); }}>Clear</Button></div>}
    {!!rows.length && <table><thead><tr>{COLS.map(([k, label]) => <th key={k} className="cursor-pointer select-none" onClick={() => setSort(s => ({ k, d: s.k === k ? (-s.d as 1 | -1) : -1 }))}>
      <span className="inline-flex items-center gap-1">{label}{sort.k === k && (sort.d === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</span></th>)}</tr></thead>
      <tbody>{view.map(r => <tr key={r.symbol} className="cursor-pointer" onClick={() => onOpen(r.slug)}><td>{r.name}</td><td>{r.category}</td><td><Badge tone={tone(r.bias)}>{r.bias.replace('_', ' ')}</Badge></td><td>{r.htfStructure}</td><td>{r.structure}</td><td>{r.momentum}</td><td>{r.volatility}</td>
        <td>{r.liquiditySweep ? 'yes' : '-'}</td><td>{r.fvg ? 'yes' : '-'}</td><td>{r.zone ?? '-'}</td><td><Badge tone={r.scn.tone} title={r.scn.text}>{r.scn.label}</Badge></td><td title={r.sm.direction ? `${r.sm.direction} SMC${r.sm.ok ? ', all checks pass' : ', not all checks pass'}${r.sm.htfAligned === false ? ', HTF disagrees' : ''}` : undefined}>{r.sm.key === 'none' ? <span className="text-muted-foreground">-</span> : <Badge tone={r.sm.direction === 'bullish' ? 'bull' : r.sm.direction === 'bearish' ? 'bear' : 'neutral'}>{r.sm.label}{r.sm.ok ? ' ✓' : ''}</Badge>}</td>
        <td className="font-mono tabular-nums">{r.distAtr == null ? '-' : r.distAtr.toFixed(1)}</td><td className="font-mono tabular-nums">{r.rr == null ? '-' : `1:${r.rr.toFixed(1)}`}</td><td>{r.confluenceScore}</td></tr>)}</tbody></table>}
    {!rows.length && !busy && <small>Press Scan to analyse every discovered market (cached for 60 seconds on the server).</small>}
  </div>;
}
