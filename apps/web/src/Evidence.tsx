import { useEffect, useState } from 'react';
import { send } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const Row = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-3 py-0.5"><span className="text-muted-foreground">{k}</span><span className="text-right font-mono">{v}</span></div>;
const pct = (x: number | null | undefined) => (x == null ? '-' : `${(x * 100).toFixed(0)}%`);
const r2 = (x: number | null | undefined) => (x == null ? '-' : x.toFixed(2));
const tone = (l: string) => (l === 'positive' ? 'bull' : l === 'negative' ? 'bear' : 'warn') as 'bull' | 'bear' | 'warn';
const title = (l: string) => (l === 'insufficient' ? 'Too few trades' : l === 'no_edge' ? 'No measurable edge' : l === 'negative' ? 'Losing rule' : 'Positive (not proof)');

/** Backtest evidence for the exact rule behind Trade signal alerts, on this market and timeframe. On demand because it is heavy. */
export function Evidence({ sym, tf }: { sym: string; tf: string }) {
  const [d, setD] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [min, setMin] = useState('70'), [strategy, setStrategy] = useState<'confluence' | 'smc'>('confluence'), [htf, setHtf] = useState(true), [slip, setSlip] = useState('0'), [fee, setFee] = useState('0');
  useEffect(() => { setD(null); setErr(''); }, [sym, tf, strategy]);
  const run = () => { setBusy(true); setErr(''); send('GET', `/api/evidence/${sym}?tf=${tf}&limit=1500&min=${parseInt(min, 10) || 70}&strategy=${strategy}&htf=${htf ? 1 : 0}&slip=${Math.min(2, Math.max(0, parseFloat(slip) || 0))}&fee=${Math.min(1, Math.max(0, parseFloat(fee) || 0))}`).then(setD).catch(e => { setD(null); setErr(e.message); }).finally(() => setBusy(false)); };
  const a = d?.all, o = d?.outOfSample;
  return <section className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence for this rule ({tf})</h3>
    <p className="mb-2 text-muted-foreground">Replays the rule behind {strategy === 'smc' ? 'SMC signal' : 'Trade signal'} alerts on this market's recent candles, using only data available at each moment, and reports how it would have done.</p>
    <div className="mb-2 flex flex-wrap items-center gap-2"><select value={strategy} onChange={e => setStrategy(e.target.value as any)}><option value="confluence">Confluence rule</option><option value="smc">SMC model</option></select>
      {strategy === 'smc' ? <label className="text-muted-foreground"><input type="checkbox" checked={htf} onChange={e => setHtf(e.target.checked)} /> Require HTF agreement</label> : <label className="text-muted-foreground">Min confluence <input className="ml-1 w-14" inputMode="numeric" value={min} onChange={e => setMin(e.target.value)} /></label>}
      <label className="text-muted-foreground" title="Adverse slippage on stop and timeout exits, as a fraction of ATR">Slippage (ATR) <input className="ml-1 w-12" inputMode="decimal" value={slip} onChange={e => setSlip(e.target.value)} /></label>
      <label className="text-muted-foreground" title="Flat cost per trade in R (fees plus spread)">Fees (R) <input className="ml-1 w-12" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} /></label>
      <Button size="sm" onClick={run} disabled={busy}>{busy ? 'Running... (up to ~10 s)' : d ? 'Run again' : 'Run evidence check'}</Button></div>
    {err && <small className="text-bear">{err}</small>}
    {d && <>
      <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone={tone(d.verdict.level)}>{title(d.verdict.level)}</Badge></div><p className="mb-2">{d.verdict.text}</p>
      <Row k="Candles tested" v={d.candles} /><Row k="Orders placed / filled / never filled" v={`${d.orders.placed} / ${d.orders.filled} / ${d.orders.missed}`} />
      <Row k="Closed trades" v={a.n} /><Row k="Win rate" v={pct(a.winRate)} /><Row k="Average R (95% range)" v={`${r2(a.avgR)}${a.ciLow != null ? ` (${r2(a.ciLow)} to ${r2(a.ciHigh)})` : ''}`} />
      <Row k="Profit factor" v={r2(a.profitFactor)} /><Row k="Max drawdown" v={`${r2(a.maxDrawdownR)}R`} /><Row k="Longest losing run" v={a.maxLossStreak} />
      <Row k="Out-of-sample trades (last 30%)" v={o.n} /><Row k="Out-of-sample average R" v={r2(o.avgR)} />
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{d.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></>}
  </section>;
}
