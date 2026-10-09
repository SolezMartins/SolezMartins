import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { send } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
/** Counts come from the scanner's real analysis; loaded on demand because it scans every market (cached 60s server-side). */
export function Overview({ tf }: { tf: string }) {
  const [d, setD] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const load = () => { setBusy(true); setErr(''); send('GET', `/api/overview?tf=${tf}`).then(setD).catch(e => setErr(e.message)).finally(() => setBusy(false)); };
  return <div className="mb-4">
    <div className="mb-2 flex flex-wrap items-center gap-2"><b>Market overview</b>
      <small>{d ? `${d.scanned} markets analysed on ${d.tf} at ${new Date(d.updatedAt).toLocaleTimeString()}` : 'Scans every discovered market.'}</small>
      <Button size="sm" onClick={load} disabled={busy}><RefreshCw className={cn('h-3 w-3', busy && 'animate-spin')} />{d ? 'Refresh' : 'Load'}</Button><small className="text-bear">{err}</small></div>
    {d && <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">{d.categories.map((c: any) => <div key={c.category} className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium">{c.category}</div>
      <div className="flex flex-wrap gap-1"><Badge tone="bull">Bullish {c.bullish}</Badge><Badge tone="bear">Bearish {c.bearish}</Badge><Badge>Neutral {c.neutral}</Badge></div>
      <small className="mt-2 block">Avg confluence {c.avgConfluence}</small></div>)}</div>}
  </div>;
}
