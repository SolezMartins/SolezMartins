import { useEffect, useState } from 'react';
import { send } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const tone = (b: string) => (b?.includes('bull') ? 'bull' : b?.includes('bear') ? 'bear' : 'neutral') as 'bull' | 'bear' | 'neutral';
/** Saved AI explanations (created when you press "Explain" on a market page). Read-only text plus the analysis snapshot it was based on. */
export function Reports() {
  const [list, setList] = useState<any[]>([]), [inst, setInst] = useState<any[]>([]), [open, setOpen] = useState<string>(''), [err, setErr] = useState(''), [loaded, setLoaded] = useState(false), [q, setQ] = useState('');
  const load = () => send('GET', '/api/reports').then((l: any[]) => { setErr(''); setList(l); setLoaded(true); }).catch(e => { setErr(e.message); setLoaded(true); });
  useEffect(() => { load(); send('GET', '/api/instruments').then(setInst).catch(() => {}); }, []);
  const name = (s: string) => inst.find(i => i.symbol === s)?.name ?? s;
  const when = (r: any) => new Date(r.createdAt).toLocaleString();
  const del = (id: string) => confirm('Delete this report?') && send('DELETE', `/api/reports/${id}`).then(() => { if (open === id) setOpen(''); return load(); }).catch(e => setErr(e.message));
  const shown = list.filter(r => !q || name(r.symbol).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-2"><b>Reports</b><small>Saved AI explanations of a market's analysis. The AI only explains the engine's numbers; it never changes them. Not financial advice.</small>
      <input placeholder="Search market" value={q} onChange={e => setQ(e.target.value)} className="ml-auto w-40" /><Button size="sm" variant="secondary" onClick={load}>Refresh</Button></div>
    <small className="text-bear">{err}</small>
    {loaded && !list.length && !err && <small>No saved reports yet. Open a market page and press the AI explanation button; the answer is saved here automatically (needs the AI enabled; saved only in Supabase mode if you use sign-in).</small>}
    {shown.map(r => { const s = r.snapshot ?? {}, isOpen = open === r.id; return <section key={r.id} className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2"><b>{name(r.symbol)}</b><Badge>{r.timeframe}</Badge>{s.bias && <Badge tone={tone(s.bias)}>{String(s.bias).replace('_', ' ')}</Badge>}{s.confluenceScore != null && <Badge>Confluence {s.confluenceScore}/100</Badge>}
        <small>{when(r)}</small><span className="ml-auto flex gap-1"><Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? '' : r.id)}>{isOpen ? 'Hide' : 'Read'}</Button><Button size="sm" variant="ghost" onClick={() => del(r.id)}>Delete</Button></span></div>
      {isOpen && <><p className="mt-2 whitespace-pre-wrap leading-relaxed">{r.explanation || 'No explanation text was saved.'}</p>
        {!!Object.keys(s).length && <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">Analysis snapshot it was based on</summary><pre className="mt-1 max-h-64 overflow-auto text-xs text-muted-foreground">{JSON.stringify(s, null, 2)}</pre></details>}</>}
    </section>; })}
    {!!list.length && !shown.length && <small>No reports match that search.</small>}
  </div>;
}
