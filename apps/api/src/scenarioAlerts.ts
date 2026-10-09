/**
 * Scenario-change alerts. Pure (no I/O) so the rules can be unit-tested; ingest.ts feeds them live prices.
 * An alert fires when the live status of a market's current scenario CHANGES to the one the alert waits for.
 * A standing state never fires: ingest re-baselines whenever the scenario itself changes (new candle) or a stream (re)starts.
 */
export const SCN_KIND: Record<string, string> = { scenario_in_zone: 'in_zone', scenario_invalidated: 'invalidated', scenario_target: 'target_passed' };
export const SCN_TEXT: Record<string, string> = { in_zone: 'price entered the entry zone (wait for confirmation)', invalidated: 'invalidated, no entry', target_passed: 'Target 1 already reached, no entry' };
/** before: status at the previous tick (undefined = no baseline yet), now: status at this tick, dir: the alert's direction filter, scnDir: direction of the market's scenario. */
export function scnHit(kind: string, before: string | null | undefined, now: string | null | undefined, dir: string | undefined, scnDir: string | undefined): boolean {
  const want = SCN_KIND[kind];
  return !!want && !!now && now === want && before !== undefined && before !== now && (!dir || dir === scnDir);
}
