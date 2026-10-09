import { useEffect, useRef, useState } from 'react';
import { createChart, type UTCTimestamp } from 'lightweight-charts';
import { ArrowLeft } from 'lucide-react';
import { prefs, send, liveSocket } from './api';
import { boxes } from './boxes';
import { liveEntry } from './scenarioStatus';
import { RiskCalc } from './RiskCalc';
import { Evidence } from './Evidence';
import { SmcCard } from './SmcCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const MAX: Record<string, number> = { htf: 15, structure: 12, ema: 10, momentum: 12, liquidity: 8, bosChoch: 8, supplyDemand: 10, fvg: 5, srLevels: 8, volatility: 5, riskReward: 7 };
const Card = ({ title, children }: { title: string; children: any }) => <section className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>;
const Row = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-3 py-0.5"><span className="text-muted-foreground">{k}</span><span className="text-right font-mono">{v}</span></div>;
const tone = (b = '') => b.includes('bull') ? 'bull' : b.includes('bear') ? 'bear' : 'neutral';

export function MarketsPage({ slug, onOpen, onHistory }: { slug: string | null; onOpen: (s: string | null) => void; onHistory: (sym: string) => void }) {
  const [inst, setInst] = useState<any[] | null>(null), [q, setQ] = useState('');
  useEffect(() => { send('GET', '/api/instruments').then(setInst).catch(() => setInst([])); }, []);
  if (!inst) return <div className="p-4"><small>Loading markets...</small></div>;
  if (slug) { const cur = inst.find(i => i.slug === slug); return cur ? <MarketDetail key={cur.symbol} inst={cur} onBack={() => onOpen(null)} onHistory={() => onHistory(cur.symbol)} /> : <div className="p-4">Market not found. <Button onClick={() => onOpen(null)}>All markets</Button></div>; }
  const groups = new Map<string, any[]>(); for (const i of inst.filter(i => i.name.toLowerCase().includes(q.toLowerCase()))) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
  return <div className="p-4"><input className="w-64" placeholder="Search markets" value={q} onChange={e => setQ(e.target.value)} />
    {[...groups].map(([cat, items]) => <div key={cat} className="mt-4"><div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">{cat} ({items.length})</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">{items.map(i => <button key={i.symbol} onClick={() => onOpen(i.slug)} className="h-auto justify-between px-3 py-2 text-left"><span>{i.name}</span>{!i.open && <Badge>closed</Badge>}</button>)}</div></div>)}
    {!inst.length && <small>No markets available. Is the API running?</small>}</div>;
}

function MarketDetail({ inst, onBack, onHistory }: { inst: any; onBack: () => void; onHistory: () => void }) {
  const sym = inst.symbol, dp = inst.pip ? Math.max(0, Math.round(-Math.log10(inst.pip))) : 2, px = (n: number | null | undefined) => n == null ? '-' : n.toFixed(dp);
  const [setups, setSetups] = useState<any[]>([]), [reload, setReload] = useState(0), [tf, setTf] = useState(prefs.defaultTf), [a, setA] = useState<any>(null), [mtf, setMtf] = useState<any>(null), [ai, setAi] = useState<any>(null), [price, setPrice] = useState<number | null>(null), [err, setErr] = useState('');
  const el = useRef<HTMLDivElement>(null), series = useRef<any>(null);
  useEffect(() => { setErr(''); setA(null); send('GET', `/api/analysis/${sym}?tf=${tf}`).then(setA).catch(e => setErr(e.message)); }, [sym, tf, reload]);
  useEffect(() => { send('GET', `/api/mtf/${sym}`).then(setMtf).catch(() => setMtf(null)); }, [sym]);
  useEffect(() => { send('GET', `/api/setups/${sym}?tf=${tf}`).then(setSetups).catch(() => setSetups([])); }, [sym, tf]);
  useEffect(() => {
    if (!a || !el.current) return;
    const C = a.candles, ch = createChart(el.current, { height: 440, layout: { background: { color: 'transparent' }, textColor: '#9aa3b5' }, grid: { vertLines: { color: 'rgba(255,255,255,.04)' }, horzLines: { color: 'rgba(255,255,255,.04)' } }, timeScale: { timeVisible: true } });
    const s = ch.addCandlestickSeries({ priceFormat: { type: 'price', precision: dp, minMove: inst.pip || 0.01 } }); series.current = s;
    s.setData(C.map((c: any) => ({ ...c, time: c.time as UTCTimestamp }))); setPrice(C[C.length - 1].close);
    s.attachPrimitive(boxes(s, [...a.detail.zones.map((z: any) => ({ t1: C[Math.min(z.i + 1, C.length - 1)].time, p1: z.upper, p2: z.lower, color: z.dir === 'demand' ? '#26a69a' : '#ef5350', label: `${z.dir} ${z.status}` })),
      ...a.detail.fvgs.map((g: any) => ({ t1: C[Math.max(g.i - 2, 0)].time, p1: g.upper, p2: g.lower, color: '#7c9cff', label: `${g.dir} FVG` }))]));
    for (const p of a.snapshot.support) s.createPriceLine({ price: p, color: '#26a69a', lineStyle: 2, lineWidth: 1, title: 'S' });
    for (const p of a.snapshot.resistance) s.createPriceLine({ price: p, color: '#ef5350', lineStyle: 2, lineWidth: 1, title: 'R' });
    ch.timeScale().fitContent(); return () => ch.remove();
  }, [a]);
  useEffect(() => liveSocket(sym, tf, m => { if (m.type === 'candle' && m.symbol === sym && m.tf === tf) { series.current?.update({ ...m.candle, time: m.candle.time as UTCTimestamp }); setPrice(m.candle.close); } }, (s, again) => { if (s === 'open' && again) setReload(n => n + 1); }), [sym, tf]); // refetch after a reconnect to fill missed candles
  const explain = () => { setAi({ loading: true }); send('POST', '/api/ai/analyze', { symbol: sym, tf }).then(r => setAi({ text: r.explanation, notice: r.notice })).catch(e => setAi({ notice: e.message })); };
  const s = a?.snapshot, d = a?.detail, sc = a?.scenario, le = liveEntry(sc, price ?? a?.candles?.[a.candles.length - 1]?.close, dp);
  return <div className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" />Markets</Button>
      <h1 className="text-lg font-semibold">{inst.name}</h1><Badge>{inst.category}</Badge><span className="font-mono text-lg tabular-nums">{px(price)}</span>
      {s && <><Badge tone={tone(s.bias)}>{s.bias.replace('_', ' ')}</Badge><Badge>Confluence {s.confluenceScore}/100</Badge></>}
      <div className="ml-auto flex gap-1">{['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map(t => <Button key={t} size="sm" variant={t === tf ? 'default' : 'secondary'} onClick={() => setTf(t)}>{t}</Button>)}</div></div>
    <small className="text-bear">{err}</small>
    <div ref={el} />
    {s && <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      <Card title="Technical state"><Row k="Structure" v={`${s.structure}${d.labels.length ? ` (${d.labels.join(' ')})` : ''}`} /><Row k="Momentum" v={s.momentum} /><Row k="RSI" v={s.rsi ?? '-'} /><Row k="EMA alignment" v={s.emaAlignment} />
        <Row k="Liquidity sweep" v={s.liquiditySweep ? 'detected' : 'none'} /><Row k="Unfilled FVG" v={s.fvg ? 'present' : 'none'} /><Row k="Latest break (20 candles)" v={d.break ?? '-'} /><Row k="HTF structure (4x)" v={s.htfStructure} /><Row k="Volatility" v={`${s.volatility} (${d.indicators.volatilityRatio?.toFixed(2)}x)`} /><Row k="Range state" v={s.rangeState} /><Row k="Candle pattern" v={s.patterns.join(', ') || '-'} /></Card>
      <Card title="Indicators">{([['EMA 20', d.indicators.ema20], ['EMA 50', d.indicators.ema50], ['EMA 100', d.indicators.ema100], ['EMA 200', d.indicators.ema200], ['SMA 50', d.indicators.sma50], ['ATR 14', d.indicators.atr], ['Avg range', d.indicators.avgRange]] as [string, number][]).map(([k, v]) => <Row key={k} k={k} v={px(v)} />)}<Row k="MACD histogram" v={d.indicators.macdHist?.toFixed(4) ?? '-'} /><Row k="ROC (10)" v={`${s.roc ?? '-'}%`} /></Card>
      <Card title="Confluence breakdown (not a win probability)">{Object.entries(d.scoreParts).map(([k, v]) => <Row key={k} k={k} v={`${v} / ${MAX[k]}`} />)}<Row k="Total" v={`${s.confluenceScore} / 100`} /></Card>
      <Card title="Multi-timeframe">{mtf ? <><Row k="Alignment" v={`${mtf.alignment.state} (${mtf.alignment.direction})`} />{mtf.alignment.byTimeframe.map((r: any) => <Row key={r.tf} k={r.tf} v={`${r.bias.replace('_', ' ')} · ${r.structure}`} />)}</> : <small>Loading...</small>}</Card>
      <Card title="Key levels"><Row k="Recent resistance" v={s.resistance.map(px).join(', ') || '-'} /><Row k="Recent support" v={s.support.map(px).join(', ') || '-'} />{d.levels.resistance.map((l: any, i: number) => <Row key={'mr' + i} k="Major resistance" v={`${px(l.price)} x${l.touches}`} />)}{d.levels.support.map((l: any, i: number) => <Row key={'ms' + i} k="Major support" v={`${px(l.price)} x${l.touches}`} />)}<small>Major = 2+ swing touches.</small></Card>
      <Card title="Supply / demand and FVG">{d.zones.map((z: any, i: number) => <Row key={i} k={`${z.dir} (${z.status})`} v={`${px(z.lower)} - ${px(z.upper)} (${px(z.distance)} away)`} />)}{d.fvgs.map((g: any, i: number) => <Row key={'f' + i} k={`${g.dir} FVG`} v={`${px(g.lower)} - ${px(g.upper)} (${Math.round((g.fillPct ?? 0) * 100)}% filled)`} />)}{d.priceActionZones.filter((z: any) => z.status !== 'invalidated').slice(-3).map((z: any, i: number) => <Row key={'pa' + i} k={`Potential ${z.dir} zone (${z.status})`} v={`${px(z.lower)} - ${px(z.upper)}`} />)}{!d.zones.length && !d.fvgs.length && <small>None active.</small>}</Card>
      <Card title="Potential scenario">{!sc ? <small>Neutral conditions: no scenario.</small> : <><div className="mb-1 font-medium">Potential {sc.direction === 'bullish' ? 'Bullish' : 'Bearish'} Scenario ({tf})</div>
        {le && <div className="mb-2 rounded-md border border-border p-2"><Badge tone={le.tone}>{le.label}</Badge><p className="mt-1 leading-relaxed">{le.text}</p></div>}
        {sc.entryZone && <><Row k={`Entry zone (${sc.entryZone.kind})`} v={`${px(sc.entryZone.lower)} - ${px(sc.entryZone.upper)}`} /><Row k="Invalidation (stop)" v={px(sc.invalidation)} />{sc.risk != null && <Row k="Risk from zone midpoint" v={`${px(sc.risk)} pts`} />}{sc.targets.map((t: number, i: number) => <Row key={i} k={`Target ${i + 1}`} v={px(t)} />)}<Row k="Estimated R:R (from zone midpoint)" v={sc.estimatedRR ? `1:${sc.estimatedRR.toFixed(1)}` : '-'} />{sc.atr != null && <Row k="ATR (typical candle range)" v={px(sc.atr)} />}</>}
        {(sc.warnings ?? []).map((w: string, i: number) => <div key={i} className="mt-1"><Badge tone="warn" className="whitespace-normal">{w}</Badge></div>)}
        <p className="mt-1 text-muted-foreground">{sc.confirmation}</p><small>{sc.note} The stop is kept at least 0.75 ATR beyond the zone so normal candle noise does not trigger it.</small></>}</Card>
      <SmcCard smc={a?.smc} price={price} dp={dp} tf={tf} />
      <RiskCalc sc={sc} price={price} dp={dp} />
      <Evidence sym={sym} tf={tf} />
      <Card title="Recent setups (outcomes)">{setups.length ? setups.slice(0, 8).map((x: any) => <Row key={x.id} k={`${new Date(x.created_ts).toLocaleDateString()} ${x.direction}`} v={`${px(x.entry_lower)}-${px(x.entry_upper)} · ${x.status.replace('_', ' ')}`} />) : <small>None recorded yet (needs Supabase and a streamed 5m+ timeframe).</small>}<small className="mt-1 block">Historical scenarios and what followed. Not a performance claim.</small></Card>
      <Card title="AI explanation"><Button size="sm" onClick={explain} disabled={ai?.loading}>{ai?.loading ? 'Analysing...' : 'Explain this analysis'}</Button>
        {ai?.text && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{ai.text}</p>}{ai?.notice && <div className="mt-2"><Badge tone="warn">{ai.notice}</Badge></div>}</Card>
      <Card title="Historical analysis"><p className="mb-2 text-muted-foreground">Replay past structure, BOS/CHOCH, sweeps, FVGs and zones.</p><Button size="sm" onClick={onHistory}>Open history</Button></Card>
    </div>}
  </div>;
}
