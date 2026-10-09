import { useEffect, useState } from 'react';
import { send } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SCENARIO_OPTIONS } from './scenarioStatus';

const pct = (x: number | null | undefined) => (x == null ? '-' : `${(x * 100).toFixed(0)}%`);
const r2 = (x: number | null | undefined) => (x == null ? '-' : x.toFixed(2));
const range = (lo: number | null, hi: number | null, f: (x: number | null) => string) => (lo == null || hi == null ? '' : ` (${f(lo)} to ${f(hi)})`);
const tone = (l: string) => (l === 'positive' ? 'bull' : l === 'negative' ? 'bear' : 'warn') as 'bull' | 'bear' | 'warn';

function Table({ title, rows, name }: { title: string; rows: any[]; name?: (k: string) => string }) {
  if (!rows.length) return null;
  return <section className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['', 'Trades', 'Win rate (95% range)', 'Avg R (95% range)', 'Total R', 'Profit factor', 'Max drawdown'].map(h => <th key={h} className="pr-3 text-xs font-normal text-muted-foreground">{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.key} className={r.n < 30 ? 'opacity-60' : ''}><td className="pr-3">{name ? name(r.key) : r.key}</td><td className="pr-3 font-mono">{r.n}{r.n < 30 ? ' ⚠' : ''}</td>
        <td className="pr-3 font-mono">{pct(r.winRate)}{range(r.winRateLow, r.winRateHigh, pct as any)}</td><td className="pr-3 font-mono">{r2(r.avgR)}{range(r.ciLow, r.ciHigh, r2 as any)}</td>
        <td className="pr-3 font-mono">{r2(r.totalR)}</td><td className="pr-3 font-mono">{r2(r.profitFactor)}</td><td className="pr-3 font-mono">{r2(r.maxDrawdownR)}R</td></tr>)}</tbody></table></div>
    <small className="mt-1 block">⚠ = fewer than 30 trades: too few to trust.</small></section>;
}

function Equity({ pts }: { pts: { t: number; r: number }[] }) {
  if (pts.length < 2) return <small>Needs at least 2 closed trades.</small>;
  const w = 600, h = 120, ys = pts.map(p => p.r), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w, y = (v: number) => h - ((v - lo) / span) * h;
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full" role="img" aria-label="Cumulative R over closed trades"><line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="4 4" />
    <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts.map((p, i) => `${x(i)},${y(p.r)}`).join(' ')} /></svg>;
}

/** Performance report built from your own journal. Research aid only: not advice, and past results do not predict future ones. */
export function Performance() {
  const [d, setD] = useState<any>(null), [err, setErr] = useState(''), [inst, setInst] = useState<any[]>([]);
  const load = () => { setErr(''); send('GET', '/api/performance').then(setD).catch(e => setErr(e.message)); };
  useEffect(() => { load(); send('GET', '/api/instruments').then(setInst).catch(() => {}); }, []);
  const nameOf = (s: string) => inst.find(i => i.symbol === s)?.name ?? s;
  const scnName = (k: string) => k === 'unknown' ? 'Not recorded (older signals)' : SCENARIO_OPTIONS.find(o => o.key === k)?.label ?? k;
  if (err) return <div className="p-4"><small className="text-bear">{err}</small></div>;
  if (!d) return <div className="p-4"><small>Loading...</small></div>;
  const o = d.overall, c = d.counts;
  return <div className="space-y-3 p-4">
    <div className="flex items-center gap-3"><b className="text-lg">Performance</b><Button size="sm" variant="secondary" onClick={load}>Refresh</Button></div>
    <section className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone={tone(d.verdict.level)}>{d.verdict.level === 'insufficient' ? 'Too few trades' : d.verdict.level === 'no_edge' ? 'No measurable edge' : d.verdict.level === 'negative' ? 'Losing' : 'Positive'}</Badge><span>{d.verdict.text}</span></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 font-mono text-sm">
        <div><div className="text-xs text-muted-foreground">Closed trades</div>{o.n}</div><div><div className="text-xs text-muted-foreground">Win rate</div>{pct(o.winRate)}</div>
        <div><div className="text-xs text-muted-foreground">Average R</div>{r2(o.avgR)}{range(o.ciLow, o.ciHigh, r2 as any)}</div><div><div className="text-xs text-muted-foreground">Total R</div>{r2(o.totalR)}</div>
        <div><div className="text-xs text-muted-foreground">Profit factor</div>{r2(o.profitFactor)}</div><div><div className="text-xs text-muted-foreground">Max drawdown</div>{r2(o.maxDrawdownR)}R</div>
        <div><div className="text-xs text-muted-foreground">Break-even win rate</div>{pct(o.breakevenWinRate)}</div><div><div className="text-xs text-muted-foreground">Longest losing run</div>{o.maxLossStreak}</div>
      </div>
      <div className="mt-2"><Equity pts={d.equity} /><small>Cumulative R over closed trades, oldest to newest.</small></div>
      <p className="mt-2 text-muted-foreground">Entries {c.entries} · Closed {c.closed} · Open {c.open} (waiting for entry {c.pending}) · Auto signals {c.signals} · Never filled {c.missed}{c.fillRate != null ? ` · Fill rate ${pct(c.fillRate)}` : ''}</p>
    </section>
    <Table title="By source" rows={d.bySource} /><Table title="By market" rows={d.byMarket} name={nameOf} /><Table title="By timeframe (auto signals only have one)" rows={d.byTimeframe} />
    <Table title="By scenario status when the signal was created (auto signals only)" rows={d.byScenario ?? []} name={scnName} />
    <Table title="By confluence score (auto signals only)" rows={d.byConfluence} /><Table title="By direction" rows={d.byDirection} />
    <section className="rounded-md border border-border bg-card p-3"><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{d.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
      <small className="mt-2 block">Analysis only. Not financial advice. Nothing here places or manages trades.</small></section>
  </div>;
}
