import { Badge } from '@/components/ui/badge';
import { liveEntry, type Scenario } from './scenarioStatus';

const Row = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-3 py-0.5"><span className="text-muted-foreground">{k}</span><span className="text-right font-mono">{v}</span></div>;
const STATUS: Record<string, string> = { waiting: 'Waiting for pullback', in_zone: 'Touching the zone', entry_passed: 'Entry level already reached', invalidated: 'Invalidated', target_passed: 'Target already reached', mitigated: 'Zone already used', stale: 'Too old' };

/** SMC read: dealing range with premium/discount, the current sweep -> shift -> order block setup (if any) and which checks pass. Analysis only. */
export function SmcCard({ smc, price, dp, tf }: { smc: any; price: number | null; dp: number; tf: string }) {
  const f = (x: number | null | undefined) => (x == null ? '-' : x.toFixed(dp));
  if (!smc) return <section className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Smart Money Concepts (SMC)</h3><small>Needs at least 40 candles.</small></section>;
  const s = smc.setup, bull = s?.direction === 'bullish', r = smc.range;
  const sc: Scenario | null = s ? { direction: s.direction, entryZone: s.entryZone, entryMid: s.entryMid, invalidation: s.invalidation, targets: s.targets, estimatedRR: s.estimatedRR, atr: s.atr } : null;
  const le = sc && ['waiting', 'in_zone', 'entry_passed'].includes(s.status) ? liveEntry(sc, price ?? smc.price, dp) : null; // live price: it can move after the last closed candle
  return <section className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Smart Money Concepts (SMC, {tf})</h3>
    <Row k="HTF structure" v={smc.htf ?? '-'} />
    {r ? <><Row k="Dealing range (last swing low to high)" v={`${f(r.low)} - ${f(r.high)}`} /><Row k="Equilibrium (50%)" v={f(r.eq)} />
      <div className="my-1 flex items-center gap-2"><span className="text-muted-foreground">Price is in</span><Badge tone={smc.zone === 'discount' ? 'bull' : smc.zone === 'premium' ? 'bear' : 'neutral'}>{smc.zone} ({Math.round(r.pct * 100)}% of range)</Badge></div>
      <small className="mb-2 block text-muted-foreground">SMC looks for longs in discount and shorts in premium.</small></> : <small className="block">No clear dealing range yet.</small>}
    {s ? <>
      <div className="mb-2 mt-2 flex flex-wrap items-center gap-2"><Badge tone={bull ? 'bull' : 'bear'}>{bull ? 'Bullish' : 'Bearish'} SMC setup</Badge><Badge tone={s.ok ? 'warn' : 'neutral'}>{STATUS[s.status] ?? s.status}</Badge>{s.ok && <Badge tone="neutral">checks pass</Badge>}</div>
      <ul className="mb-2 space-y-0.5">{s.checks.map((c: any) => <li key={c.key} className="flex gap-2"><span className={c.ok === true ? 'text-bull' : c.ok === false ? 'text-bear' : 'text-muted-foreground'}>{c.ok === true ? '✓' : c.ok === false ? '✗' : '–'}</span><span className={c.ok === false ? 'text-muted-foreground' : ''}>{c.label}</span></li>)}</ul>
      {le && <div className="mb-2 rounded-md border border-border p-2"><Badge tone={le.tone}>{le.label}</Badge><p className="mt-1 leading-relaxed">{le.text}</p></div>}
      <Row k={`Entry zone (${s.entryZone.kind})`} v={`${f(s.entryZone.lower)} - ${f(s.entryZone.upper)}`} /><Row k="Entry (zone midpoint)" v={f(s.entryMid)} /><Row k="Stop (beyond the sweep)" v={f(s.invalidation)} />
      {s.targets.map((t: number, i: number) => <Row key={i} k={`Target ${i + 1} (untouched ${bull ? 'high' : 'low'})`} v={f(t)} />)}<Row k="Estimated R:R" v={s.estimatedRR ? `1:${s.estimatedRR.toFixed(1)}` : '-'} />
      <Row k="Sweep" v={`${f(s.sweep.level)} (wick to ${f(s.sweep.extreme)})`} /><Row k="Structure shift (close beyond)" v={f(s.mss.level)} /><Row k="Age" v={`${s.ageCandles} candles`} />
    </> : smc.partial ? <div className="mt-2"><Badge tone="warn">Sweep seen, no setup yet</Badge><p className="mt-1 leading-relaxed">{smc.partial.text}</p></div>
      : <p className="mt-2 text-muted-foreground">No SMC setup. It needs: a liquidity sweep of a swing high or low, then a structure shift with displacement, then an untouched order block in discount (long) or premium (short).</p>}
    <small className="mt-2 block">Analysis only, not a signal or a prediction: an SMC setup is a chart pattern, not a win probability. Check the Evidence card with the SMC model selected to see how it has performed here.</small>
  </section>;
}
