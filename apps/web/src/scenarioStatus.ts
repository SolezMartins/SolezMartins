/**
 * Pure helpers for the market page: is the scenario's entry still valid at the LIVE price, and how much can a trade risk.
 * No React here so the math can be unit-tested (tests/engine.test.mts). Analysis only, not advice.
 */

export type Scenario = {
  direction: 'bullish' | 'bearish'; entryZone: { kind: string; lower: number; upper: number } | null;
  entryMid?: number; invalidation: number; targets: number[]; estimatedRR: number | null; atr?: number | null;
};
export type EntryStatus = 'waiting' | 'in_zone' | 'through_zone' | 'invalidated' | 'target_passed';
export type LiveEntry = {
  status: EntryStatus; tone: 'warn' | 'bull' | 'bear' | 'neutral'; label: string; text: string;
  distance: number; distanceAtr: number | null; riskNow: number; rrNow: number | null; chasing: boolean;
};

const n = (x: number, dp: number) => x.toFixed(dp);

/** Status of the entry at the current price. `dp` = decimals to print. Returns null when there is no entry zone or no price. */
export function liveEntry(sc: Scenario | null | undefined, price: number | null | undefined, dp = 2): LiveEntry | null {
  if (!sc?.entryZone || price == null || !Number.isFinite(price)) return null;
  const bull = sc.direction === 'bullish', z = sc.entryZone, t1 = sc.targets[0], atr = sc.atr && sc.atr > 0 ? sc.atr : null;
  const distance = bull ? price - z.upper : z.lower - price; // > 0: price has not pulled back to the zone yet
  const beyondStop = bull ? price <= sc.invalidation : price >= sc.invalidation;
  const targetPassed = t1 !== undefined && (bull ? price >= t1 : price <= t1);
  const inZone = price >= z.lower && price <= z.upper;
  const status: EntryStatus = beyondStop ? 'invalidated' : targetPassed ? 'target_passed' : distance > 0 ? 'waiting' : inZone ? 'in_zone' : 'through_zone';
  const riskNow = Math.abs(price - sc.invalidation), rewardNow = t1 === undefined ? null : bull ? t1 - price : price - t1;
  const rrNow = rewardNow !== null && riskNow > 0 ? rewardNow / riskNow : null, distanceAtr = atr ? Math.max(0, distance) / atr : null;
  const chasing = status === 'waiting' && (atr ? distance > 0.5 * atr : false);
  const side = bull ? 'above' : 'below', plan = sc.estimatedRR ? `1:${n(sc.estimatedRR, 1)}` : 'the plan';
  const text = ({
    waiting: `Price is ${n(distance, dp)} points${distanceAtr !== null ? ` (${n(distanceAtr, 1)} ATR)` : ''} ${side} the entry zone. The plan is to wait for a pullback into the zone. Entering now puts your stop ${n(riskNow, dp)} points away and the R:R at about ${rrNow !== null ? `1:${n(rrNow, 1)}` : 'n/a'} instead of ${plan}.${chasing ? ' This is chasing the move.' : ''}`,
    in_zone: 'Price is inside the entry zone. The scenario still needs a confirmation (a reaction from the zone or a BOS) before it counts as triggered.',
    through_zone: 'Price has pushed through the zone but is not yet past the stop. The zone is weakening: the scenario is at risk of failing.',
    invalidated: 'Price is beyond the invalidation level. This scenario has failed: no entry.',
    target_passed: 'Price has already reached Target 1. The move this scenario described has happened: no entry.',
  } as Record<EntryStatus, string>)[status];
  const label = ({ waiting: chasing ? 'Waiting: do not chase' : 'Waiting for pullback', in_zone: 'In entry zone', through_zone: 'Through the zone', invalidated: 'Invalidated', target_passed: 'Target already reached' } as Record<EntryStatus, string>)[status];
  const tone = ({ waiting: 'warn', in_zone: 'bull', through_zone: 'warn', invalidated: 'bear', target_passed: 'neutral' } as Record<EntryStatus, LiveEntry['tone']>)[status];
  return { status, tone, label, text, distance, distanceAtr, riskNow, rrNow, chasing };
}

export type ScenarioKey = 'in_zone' | 'waiting' | 'do_not_chase' | 'through_zone' | 'target_passed' | 'invalidated' | 'no_zone' | 'none';
export type ScenarioView = { key: ScenarioKey; label: string; tone: LiveEntry['tone']; rank: number; text: string; distanceAtr: number | null; rr: number | null };
/** Scenario options for the scanner filter, in the order they are most actionable (rank). Labels match the market page badge. */
export const SCENARIO_OPTIONS: { key: ScenarioKey; label: string }[] = [
  { key: 'in_zone', label: 'In entry zone' }, { key: 'waiting', label: 'Waiting for pullback' }, { key: 'do_not_chase', label: 'Waiting: do not chase' },
  { key: 'through_zone', label: 'Through the zone' }, { key: 'target_passed', label: 'Target already reached' }, { key: 'invalidated', label: 'Invalidated' },
  { key: 'no_zone', label: 'No entry zone found' }, { key: 'none', label: 'No scenario (neutral)' },
];
/** One-row summary for lists: reuses liveEntry so the scanner and the market page always agree. */
export function scenarioView(sc: Scenario | null | undefined, price: number | null | undefined, dp = 2): ScenarioView {
  const opt = (key: ScenarioKey) => SCENARIO_OPTIONS.findIndex(o => o.key === key), label = (key: ScenarioKey) => SCENARIO_OPTIONS[opt(key)].label;
  if (!sc) return { key: 'none', label: label('none'), tone: 'neutral', rank: opt('none'), text: 'Neutral conditions: no scenario.', distanceAtr: null, rr: null };
  const le = liveEntry(sc, price, dp);
  if (!le) return { key: 'no_zone', label: label('no_zone'), tone: 'neutral', rank: opt('no_zone'), text: 'No unfilled zone or FVG on the pullback side, so no entry zone is identified.', distanceAtr: null, rr: null };
  const key: ScenarioKey = le.status === 'waiting' && le.chasing ? 'do_not_chase' : le.status;
  return { key, label: le.label, tone: le.tone, rank: opt(key), text: le.text, distanceAtr: le.distanceAtr, rr: sc.estimatedRR ?? null }; // distanceAtr: 0 inside/through the zone; rr: planned R:R from the zone midpoint
}

export type RiskInput = { balance: number; riskPct: number; entry: number; stop: number; target?: number | null; multiplier?: number | null };
export type RiskPlan = {
  maxLoss: number; stopDistance: number; stopPct: number;
  stake: number | null; lossAtStop: number | null; profitAtTarget: number | null; rMultiple: number | null;
  stopOutPoints: number | null; stopOutBeforeStop: boolean; exceedsBalance: boolean; warnings: string[];
};

/**
 * Risk sizing. maxLoss = balance x risk%. With a Deriv multiplier contract, profit/loss ~ stake x multiplier x (price change / entry price),
 * and the contract stops out when the loss reaches the stake, so a stop beyond that point can never be reached. Commission and deal-cancellation
 * fees are NOT included. Returns null for invalid input.
 */
export function riskPlan(i: RiskInput): RiskPlan | null {
  const { balance, riskPct, entry, stop, target, multiplier } = i;
  if (![balance, riskPct, entry, stop].every(Number.isFinite) || balance <= 0 || riskPct <= 0 || riskPct > 100 || entry <= 0) return null;
  const maxLoss = balance * riskPct / 100, stopDistance = Math.abs(entry - stop), stopPct = stopDistance / entry, warnings: string[] = [];
  if (stopDistance === 0) return null;
  if (riskPct > 2) warnings.push(`${riskPct}% per trade is above the common 1% to 2% guideline: a short losing streak would cost a large part of your balance.`);
  const base = { maxLoss, stopDistance, stopPct, stake: null, lossAtStop: null, profitAtTarget: null, rMultiple: null, stopOutPoints: null, stopOutBeforeStop: false, exceedsBalance: false };
  if (!multiplier || !Number.isFinite(multiplier) || multiplier <= 0) return { ...base, warnings };
  const lossFrac = multiplier * stopPct, stopOutPoints = entry / multiplier, stopOutBeforeStop = lossFrac >= 1;
  const stake = stopOutBeforeStop ? maxLoss : maxLoss / lossFrac; // when stop-out comes first, the most you can lose is the stake itself
  const lossAtStop = stopOutBeforeStop ? stake : stake * lossFrac;
  const profitAtTarget = target !== undefined && target !== null && Number.isFinite(target) ? stake * multiplier * (Math.abs(target - entry) / entry) : null;
  const exceedsBalance = stake > balance;
  if (stopOutBeforeStop) warnings.push(`At ${multiplier}x the contract stops out after about ${stopOutPoints.toFixed(2)} points, which is closer than your stop (${stopDistance.toFixed(2)} points). The stop can never be reached: you would lose the whole stake first. Use a lower multiplier.`);
  if (exceedsBalance) warnings.push('The stake needed is larger than your balance. Lower the multiplier, risk less, or use a closer stop.');
  return { ...base, stake, lossAtStop, profitAtTarget, rMultiple: profitAtTarget !== null && lossAtStop > 0 ? profitAtTarget / lossAtStop : null, stopOutPoints, stopOutBeforeStop, exceedsBalance, warnings };
}

export type SmcKey = 'in_zone' | 'waiting' | 'do_not_chase' | 'through_zone' | 'target_passed' | 'invalidated' | 'mitigated' | 'stale' | 'sweep_only' | 'none';
/** SMC status options for the scanner filter, most actionable first. Same wording as the SMC card on the market page where they overlap. */
export const SMC_OPTIONS: { key: SmcKey; label: string }[] = [
  { key: 'in_zone', label: 'In entry zone' }, { key: 'waiting', label: 'Awaiting pullback' }, { key: 'do_not_chase', label: 'Waiting: do not chase' },
  { key: 'through_zone', label: 'Entry level already reached' }, { key: 'target_passed', label: 'Target already reached' }, { key: 'invalidated', label: 'Invalidated' },
  { key: 'mitigated', label: 'Zone already used' }, { key: 'stale', label: 'Too old' }, { key: 'sweep_only', label: 'Sweep seen, no setup yet' }, { key: 'none', label: 'No SMC setup' },
];
export type SmcView = { key: SmcKey; label: string; rank: number; direction: string; ok: boolean; htfAligned: boolean | null; distanceAtr: number | null; rr: number | null };
/** One-row SMC summary for the scanner: the setup's zone/stop/target checked against the live price with the same liveEntry() as everything else. */
export function smcView(smc: any, price: number | null | undefined, dp = 2): SmcView {
  const rank = (key: SmcKey) => SMC_OPTIONS.findIndex(o => o.key === key), mk = (key: SmcKey, x: Partial<SmcView> = {}): SmcView => ({ key, label: SMC_OPTIONS[rank(key)].label, rank: rank(key), direction: '', ok: false, htfAligned: null, distanceAtr: null, rr: null, ...x });
  if (!smc) return mk('none');
  if (smc.partial) return mk('sweep_only', { direction: smc.direction });
  const base = { direction: smc.direction, ok: !!smc.ok, htfAligned: smc.htfAligned ?? null, rr: smc.estimatedRR ?? null };
  if (smc.status === 'mitigated' || smc.status === 'stale') return mk(smc.status, base);
  const le = liveEntry({ direction: smc.direction, entryZone: smc.entryZone, entryMid: smc.entryMid, invalidation: smc.invalidation, targets: smc.targets, estimatedRR: smc.estimatedRR, atr: smc.atr }, price, dp);
  if (!le) return mk('none');
  const key: SmcKey = le.status === 'waiting' && le.chasing ? 'do_not_chase' : le.status;
  return mk(key, { ...base, distanceAtr: le.distanceAtr });
}
