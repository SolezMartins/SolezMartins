import { useEffect, useRef, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { send } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const SUGGEST = ['Analyze this market on 15 minutes', 'Explain the current 4H and 15M structure', 'Explain the latest liquidity sweep', 'What is happening across Volatility indices?', 'Compare V75 and V100'];
type Msg = { role: 'user' | 'assistant'; text?: string; notice?: string | null; context?: any; snapshots?: any[] };
export function Analyst({ sym }: { sym: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [convs, setConvs] = useState<any[]>([]), [cid, setCid] = useState<string | undefined>(), end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  const loadConvs = () => send('GET', '/api/conversations').then((l: any[]) => setConvs(l)).catch(() => {});
  useEffect(() => { loadConvs(); }, []);
  const open = (id: string) => send('GET', `/api/conversations/${id}/messages`).then((ms: any[]) => { setCid(id); setMsgs(ms.map(m => ({ role: m.role, text: m.content || undefined, notice: m.notice, context: m.context, snapshots: m.snapshots }))); }).catch(() => {});
  const del = (id: string) => confirm('Delete this chat?') && send('DELETE', `/api/conversations/${id}`).then(() => { if (cid === id) { setCid(undefined); setMsgs([]); } loadConvs(); }).catch(() => {});
  const ask = (question: string) => {
    if (!question.trim() || busy) return;
    setMsgs(m => [...m, { role: 'user', text: question }]); setQ(''); setBusy(true);
    send('POST', '/api/ai/chat', { question, symbol: sym, conversationId: cid }).then(r => { setCid(r.conversationId); loadConvs(); setMsgs(m => [...m, { role: 'assistant', text: r.answer ?? undefined, notice: r.notice, context: r.context, snapshots: r.snapshots }]); })
      .catch(e => setMsgs(m => [...m, { role: 'assistant', notice: e.message }])).finally(() => setBusy(false));
  };
  return <div className="flex h-full">
    <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-auto border-r border-border p-2 md:flex">
      <Button size="sm" onClick={() => { setCid(undefined); setMsgs([]); }}><Plus className="h-3.5 w-3.5" />New chat</Button>
      {convs.map(c => <div key={c.id} className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted ${c.id === cid ? 'bg-muted' : ''}`}>
        <button className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left hover:bg-transparent" onClick={() => open(c.id)} title={c.title}>{c.title || 'Chat'}</button>
        <button className="border-0 bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-bear" onClick={() => del(c.id)} aria-label="Delete chat"><Trash2 className="h-3 w-3" /></button></div>)}
      {!convs.length && <small className="p-2">No saved chats yet.</small>}
    </aside>
    <div className="mx-auto flex h-full min-w-0 max-w-4xl flex-1 flex-col p-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
        {!msgs.length && <div className="space-y-2"><b>AI Analyst</b><p className="text-muted-foreground">Explains the platform's calculated analysis. It never calculates, predicts or places trades. Without a Gemini key, the tables still show the technical data. Chats are saved; each question is analysed fresh.</p>
          <div className="flex flex-wrap gap-2">{SUGGEST.map(s => <Button key={s} size="sm" onClick={() => ask(s)}>{s}</Button>)}</div></div>}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="ml-auto w-fit max-w-[80%] rounded-md bg-muted px-3 py-2">{m.text}</div>
          : <div key={i} className="space-y-2 rounded-md border border-border bg-card p-3">
            {m.text && <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>}
            {m.notice && <Badge tone="warn">{m.notice}</Badge>}
            {m.context && <small className="block">Based on the current analysis of {m.context.markets.join(', ')} ({m.context.timeframes.join(', ')}). Technical analysis remains active even if the AI is unavailable.</small>}
            {!!m.snapshots?.length && <table><thead><tr>{['Market', 'Bias', 'Structure', 'Momentum', 'RSI', 'Sweep', 'FVG', 'Confluence'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{m.snapshots.map((s, j) => <tr key={j}><td>{s.market} {s.timeframe}</td><td>{s.bias}</td><td>{s.structure}</td><td>{s.momentum}</td><td>{s.rsi ?? '-'}</td><td>{s.liquiditySweep ? 'yes' : '-'}</td><td>{s.fvg ? 'yes' : '-'}</td><td>{s.confluenceScore}</td></tr>)}</tbody></table>}
          </div>)}
        {busy && <small>Analysing...</small>}<div ref={end} />
      </div>
      <div className="mt-3 flex gap-2"><input className="h-9 flex-1" placeholder="Ask about a market, e.g. Why is V50 currently bullish?" maxLength={500} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(q)} />
        <Button variant="default" className="h-9" onClick={() => ask(q)} disabled={busy}><Send className="h-3.5 w-3.5" />Ask</Button></div>
      <small className="mt-1">Not financial advice. Scores are technical confluence, not win probability. Snapshots in saved chats are from the time of the question.</small>
    </div>
  </div>;
}
