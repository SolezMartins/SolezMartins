import { useState } from 'react';
import { riskPlan, type Scenario } from './scenarioStatus';
import { Badge } from '@/components/ui/badge';

const Row = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-3 py-0.5"><span className="text-muted-foreground">{k}</span><span className="text-right font-mono">{v}</span></div>;
const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked: the calculator still works */ } };

/** Risk calculator: how much you can lose, and for a Deriv multiplier contract, the stake that matches it. Analysis only, not advice. */
export function RiskCalc({ sc, price, dp }: { sc: Scenario | null | undefined; price: number | null; dp: number }) {
  const [balance, setBalance] = useState(() => load('dmi.balance', '')), [pct, setPct] = useState(() => load('dmi.riskPct', '1')), [mult, setMult] = useState(() => load('dmi.mult', ''));
  const [basis, setBasis] = useState<'plan' | 'now'>('plan');
  const z = sc?.entryZone, bull = sc?.direction === 'bullish';
  const entry = !sc || !z ? null : basis === 'now' ? price : sc.entryMid ?? (z.lower + z.upper) / 2;
  const f = (x: number | null | undefined) => (x == null ? '-' : x.toFixed(dp));
  const money = (x: number | null | undefined) => (x == null ? '-' : x.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const plan = sc && entry != null ? riskPlan({ balance: parseFloat(balance), riskPct: parseFloat(pct), entry, stop: sc.invalidation, target: sc.targets[0], multiplier: mult ? parseFloat(mult) : null }) : null;
  const set = (setter: (v: string) => void, key: string) => (e: any) => { setter(e.target.value); save(key, e.target.value); };
  return <section className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Risk calculator</h3>
    {!sc || !z ? <small>Needs a scenario with an entry zone (not neutral).</small> : <>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-muted-foreground">Account balance<input className="mt-0.5 w-full" inputMode="decimal" placeholder="e.g. 100" value={balance} onChange={set(setBalance, 'dmi.balance')} /></label>
        <label className="text-muted-foreground">Risk per trade (%)<input className="mt-0.5 w-full" inputMode="decimal" placeholder="1" value={pct} onChange={set(setPct, 'dmi.riskPct')} /></label>
        <label className="text-muted-foreground">Multiplier (optional)<input className="mt-0.5 w-full" inputMode="numeric" placeholder="e.g. 20" value={mult} onChange={set(setMult, 'dmi.mult')} /></label>
        <label className="text-muted-foreground">Entry price<select className="mt-0.5 w-full" value={basis} onChange={e => setBasis(e.target.value as any)}><option value="plan">Plan: zone midpoint</option><option value="now">Now: live price</option></select></label>
      </div>
      <Row k={`${bull ? 'Long' : 'Short'} entry`} v={f(entry)} /><Row k="Stop (invalidation)" v={f(sc.invalidation)} /><Row k="Target 1" v={f(sc.targets[0])} />
      {plan ? <>
        <Row k="Stop distance" v={`${f(plan.stopDistance)} pts (${(plan.stopPct * 100).toFixed(3)}%)`} />
        <Row k="Most you accept losing" v={money(plan.maxLoss)} />
        {plan.stake !== null ? <>
          <Row k={`Stake at ${mult}x`} v={money(plan.stake)} /><Row k="Loss if stop is hit" v={money(plan.lossAtStop)} />
          <Row k="Profit at Target 1" v={money(plan.profitAtTarget)} /><Row k="Reward : risk" v={plan.rMultiple !== null ? `${plan.rMultiple.toFixed(2)} : 1` : '-'} />
          <Row k="Contract stops out after" v={`~${f(plan.stopOutPoints)} pts`} />
        </> : <p className="mt-1 text-muted-foreground">No multiplier entered. If you trade a fixed-payout contract (rise/fall, even/odd and similar) there is no stop: the most you can lose is your stake, so keep the stake at or below {money(plan.maxLoss)}.</p>}
        {plan.warnings.map((w, i) => <div key={i} className="mt-1"><Badge tone="warn" className="whitespace-normal">{w}</Badge></div>)}
      </> : <small className="mt-1 block">Enter your balance and a risk % to see the numbers.</small>}
      <small className="mt-2 block">Estimates only: multiplier math ignores commission, deal-cancellation fees and slippage, and a stop is not guaranteed to fill at its price. Not financial advice.</small></>}
  </section>;
}
