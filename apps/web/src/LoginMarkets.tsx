import { useEffect, useRef, useState } from 'react';

/**
 * Login-screen market widgets. They try Deriv's public tick feed straight from the browser (no sign-in or token needed for market data) and show real prices and
 * candles. If the feed cannot be reached they fall back to a clearly labelled SIMULATED random walk, so the panels always move and never pretend to be live.
 */
type Kind = 'vol' | 'boom' | 'crash';
const MARKETS: { sym: string; name: string; sub: string; start: number; dp: number; vol: number; kind: Kind; badge: string; cls: string }[] = [
  { sym: 'R_10', name: 'Volatility 10', sub: 'Volatility 10 Index', start: 6458.21, dp: 2, vol: 0.00018, kind: 'vol', badge: 'V', cls: '' },
  { sym: 'R_75', name: 'Volatility 75', sub: 'Volatility 75 Index', start: 392847.5, dp: 2, vol: 0.0007, kind: 'vol', badge: 'V', cls: 'pound' },
  { sym: 'R_100', name: 'Volatility 100', sub: 'Volatility 100 Index', start: 1324.58, dp: 2, vol: 0.0009, kind: 'vol', badge: 'V', cls: 'gold' },
  { sym: 'BOOM1000', name: 'Boom 1000', sub: 'Boom 1000 Index', start: 14231.62, dp: 3, vol: 0.00012, kind: 'boom', badge: 'B', cls: 'aud' },
  { sym: 'CRASH1000', name: 'Crash 1000', sub: 'Crash 1000 Index', start: 8764.37, dp: 3, vol: 0.00012, kind: 'crash', badge: 'C', cls: 'yen' },
];
export type Candle = { id: number; o: number; h: number; l: number; c: number };
type State = { price: number; open: number; dir: 0 | 1 | -1; n: number; candles: Candle[]; dp?: number; h24?: boolean };
export type Mode = 'sim' | 'live';
const TICKS_PER_CANDLE = 5, MAX_CANDLES = 22, TICK_MS = 900;

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function step(price: number, m: typeof MARKETS[number]) {
  let r = gauss() * m.vol;
  if (m.kind === 'boom') r = -Math.abs(r) * 0.6 + (Math.random() < 0.035 ? m.vol * (14 + Math.random() * 14) : 0); // slow drift down, sudden spikes up
  if (m.kind === 'crash') r = Math.abs(r) * 0.6 - (Math.random() < 0.035 ? m.vol * (14 + Math.random() * 14) : 0);
  return price * (1 + r);
}
/** Seed some history so the chart is not empty on first paint. */
function seed(m: typeof MARKETS[number]): State {
  let p = m.start, id = 0; const candles: Candle[] = [];
  for (let i = 0; i < MAX_CANDLES - 1; i++) { const o = p; let h = p, l = p; for (let t = 0; t < TICKS_PER_CANDLE; t++) { p = step(p, m); h = Math.max(h, p); l = Math.min(l, p); } candles.push({ id: id++, o, h, l, c: p }); }
  return { price: p, open: candles[0].o, dir: 0, n: id, candles: [...candles, { id: id++, o: p, h: p, l: p, c: p }] };
}

const URLS = ['wss://api.derivws.com/trading/v1/options/ws/public', 'wss://ws.derivws.com/websockets/v3?app_id=' + ((import.meta as any).env?.VITE_DERIV_APP_ID || '1089')], BUCKET = 10; // live candles are 10 seconds wide
export function useSim() {
  const [sel, setSel] = useState(1), [data, setData] = useState<State[]>(() => MARKETS.map(seed)), [mode, setMode] = useState<Mode>('sim'), ticks = useRef(0), modeRef = useRef<Mode>('sim');
  // Simulated feed: runs until real prices arrive, and again if the live feed goes quiet.
  useEffect(() => {
    const t = setInterval(() => {
      if (modeRef.current === 'live') return;
      ticks.current++;
      setData(prev => prev.map((s, i) => {
        const m = MARKETS[i], price = step(s.price, m), candles = s.candles.slice(), last = candles[candles.length - 1];
        candles[candles.length - 1] = { ...last, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price };
        let n = s.n;
        if (ticks.current % TICKS_PER_CANDLE === 0) { candles.push({ id: n++, o: price, h: price, l: price, c: price }); if (candles.length > MAX_CANDLES) candles.shift(); }
        return { price, open: s.open, dir: price > s.price ? 1 : price < s.price ? -1 : 0, n, candles, dp: s.dp, h24: s.h24 };
      }));
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);
  // Live feed: Deriv public WebSocket. Subscribes to each market's ticks, builds 10 s candles, reads the 24 h open for the % change.
  useEffect(() => {
    let ws: WebSocket | undefined, dead = false, ep = 0, retry: any, watchdog: any, lastTick = 0;
    const live = MARKETS.map(() => ({ price: NaN, open: NaN, h24: false, dp: undefined as number | undefined, n: 0, bucket: -1, candles: [] as Candle[] }));
    const idx = new Map(MARKETS.map((m, i) => [m.sym, i] as const));
    const addTick = (i: number, price: number, epoch: number, mutate = true) => {
      const L = live[i], b = Math.floor(epoch / BUCKET), last = L.candles[L.candles.length - 1];
      if (b !== L.bucket || !last) { L.bucket = b; L.candles.push({ id: L.n++, o: price, h: price, l: price, c: price }); if (L.candles.length > MAX_CANDLES) L.candles.shift(); }
      else { last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; }
      const prev = L.price; L.price = price; return mutate ? prev : prev;
    };
    const ready = () => live.every(L => Number.isFinite(L.price) && L.candles.length > 1);
    const push = (i?: number) => {
      if (!ready()) return;
      if (modeRef.current !== 'live') { modeRef.current = 'live'; setMode('live'); }
      setData(prev => prev.map((s, k) => { if (i !== undefined && k !== i) return s; const L = live[k], p = s.price, open = Number.isFinite(L.open) ? L.open : L.candles[0].o;
        return { price: L.price, open, dir: i === undefined ? 0 : L.price > p ? 1 : L.price < p ? -1 : 0, n: L.n, candles: L.candles.map(c => ({ ...c })), dp: L.dp, h24: L.h24 }; }));
    };
    const connect = () => {
      if (dead) return;
      let opened = false;
      try { ws = new WebSocket(URLS[ep % URLS.length]); } catch { ep++; retry = setTimeout(connect, 4000); return; }
      const sock = ws;
      sock.onopen = () => {
        opened = true;
        MARKETS.forEach((m, i) => {
          sock.send(JSON.stringify({ ticks_history: m.sym, style: 'ticks', end: 'latest', count: 150, req_id: 100 + i }));
          sock.send(JSON.stringify({ ticks_history: m.sym, style: 'candles', granularity: 3600, end: 'latest', count: 24, req_id: 200 + i }));
        });
        sock.send(JSON.stringify({ ticks: MARKETS.map(m => m.sym)[0], subscribe: 1 })); MARKETS.slice(1).forEach(m => sock.send(JSON.stringify({ ticks: m.sym, subscribe: 1 })));
      };
      sock.onmessage = e => {
        let m: any; try { m = JSON.parse(e.data); } catch { return; }
        if (m.error) return;
        const rid = m.echo_req?.req_id ?? m.req_id;
        if (m.msg_type === 'history' && m.history && rid >= 100 && rid < 200) {
          const i = rid - 100, L = live[i], pr: any[] = m.history.prices ?? [], tm: any[] = m.history.times ?? []; L.candles = []; L.bucket = -1; L.n = 0;
          pr.forEach((p, k) => addTick(i, +p, +tm[k])); lastTick = Date.now(); push();
        } else if (m.msg_type === 'candles' && Array.isArray(m.candles) && m.candles.length && rid >= 200 && rid < 300) {
          const i = rid - 200; live[i].open = +m.candles[0].open; live[i].h24 = true; push();
        } else if (m.msg_type === 'tick' && m.tick) {
          const i = idx.get(m.tick.symbol ?? m.tick.underlying_symbol); if (i === undefined) return;
          const q = +m.tick.quote, pip = Number(m.tick.pip_size); if (!Number.isFinite(q)) return;
          if (Number.isInteger(pip) && pip >= 0 && pip <= 8) live[i].dp = pip;
          if (live[i].candles.length === 0) { live[i].open = Number.isFinite(live[i].open) ? live[i].open : q; }
          addTick(i, q, +m.tick.epoch || Date.now() / 1000); lastTick = Date.now(); push(i);
        }
      };
      const lost = () => { if (dead) return; if (!opened) ep++; sock.onclose = null; try { sock.close(); } catch { /* already closed */ } clearTimeout(retry); retry = setTimeout(connect, 3000); };
      sock.onerror = lost; sock.onclose = lost;
    };
    connect();
    // If real ticks stop arriving for 20 s, show the simulation again (clearly labelled) instead of a frozen panel.
    watchdog = setInterval(() => { if (modeRef.current === 'live' && Date.now() - lastTick > 20000) { modeRef.current = 'sim'; setMode('sim'); } }, 5000);
    return () => { dead = true; clearTimeout(retry); clearInterval(watchdog); if (ws) { ws.onclose = null; ws.onerror = null; try { ws.close(); } catch { /* ignore */ } } };
  }, []);
  return { sel, setSel, data, mode };
}
type Sim = ReturnType<typeof useSim>;
const fmt = (x: number, dp: number) => x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (s: State) => ((s.price - s.open) / s.open) * 100;

export function WatchPanel({ sim }: { sim: Sim }) {
  return <aside className="market-panel left-panel" aria-label={sim.mode === 'live' ? 'Live market watch' : 'Simulated market watch'}>
    <div className="panel-heading"><span>MARKET WATCH</span><span className={'tiny-label' + (sim.mode === 'live' ? ' is-live' : '')}>{sim.mode === 'live' ? 'LIVE' : 'SIMULATED'}</span></div>
    {MARKETS.map((m, i) => { const s = sim.data[i], p = pct(s);
      return <button type="button" key={m.sym} className={'pair-row' + (sim.sel === i ? ' picked' : '')} onClick={() => sim.setSel(i)} aria-pressed={sim.sel === i}>
        <span className={'pair-icon ' + m.cls}>{m.badge}</span><span className="pair-name">{m.name}<small>{m.sub}</small></span>
        <span className="pair-value"><span key={s.n + ':' + s.price} className={s.dir > 0 ? 'flash-up' : s.dir < 0 ? 'flash-down' : ''}>{fmt(s.price, s.dp ?? m.dp)}</span><small className={p >= 0 ? 'up' : 'down'}>{p >= 0 ? '+' : '−'}{Math.abs(p).toFixed(2)}%</small></span></button>; })}
    <div className="panel-foot"><span className="pulse-line"></span> {sim.mode === 'live' ? 'Live Deriv synthetic index prices · % change over 24 h' : 'Simulated prices, not live market data'}</div></aside>;
}

export function ChartPanel({ sim }: { sim: Sim }) {
  const m = MARKETS[sim.sel], s = sim.data[sim.sel], p = pct(s), W = 270, H = 250, pad = 14, slot = W / MAX_CANDLES, bw = Math.max(5, slot * 0.5);
  const hi = Math.max(...s.candles.map(c => c.h)), lo = Math.min(...s.candles.map(c => c.l)), span = hi - lo || 1;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const first = s.candles[0].id, bull = p >= 0;
  const trend = s.candles.map((c, i) => `${((c.id - first) * slot + slot / 2).toFixed(1)},${y(c.c).toFixed(1)}`).join(' ');
  return <aside className="market-panel right-panel" aria-label={sim.mode === 'live' ? 'Live candlestick chart' : 'Simulated candlestick chart'}>
    <div className="panel-heading"><span>{m.sub.toUpperCase()}</span><span className={bull ? 'up' : 'down'}>{bull ? '+' : '−'}{Math.abs(p).toFixed(2)}%</span></div>
    <div className="chart-meta"><b key={s.price} className={s.dir > 0 ? 'flash-up' : s.dir < 0 ? 'flash-down' : ''}>{fmt(s.price, s.dp ?? m.dp)}</b><span className={bull ? 'up' : 'down'}>{bull ? '+' : '−'}{fmt(Math.abs(s.price - s.open), s.dp ?? m.dp)} {sim.mode === 'live' && s.h24 ? 'in 24 h' : 'this session'}</span></div>
    <div className="chart-wrap"><svg className="candles" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={sim.mode === 'live' ? 'Live candlestick chart' : 'Simulated candlestick chart'}>
      <g className="chart-lines"><path d="M0 30H270M0 75H270M0 120H270M0 165H270M0 210H270" /><path d="M45 0V250M90 0V250M135 0V250M180 0V250M225 0V250" /></g>
      <polyline className="chart-trend-live" points={trend} />
      {s.candles.map(c => { const up = c.c >= c.o, x = (c.id - first) * slot, top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
        return <g key={c.id} className={'sim-candle ' + (up ? 'sc-up' : 'sc-down')} style={{ transform: `translateX(${x}px)` }}>
          <line x1={slot / 2} x2={slot / 2} y1={y(c.h)} y2={y(c.l)} /><rect x={(slot - bw) / 2} width={bw} y={top} height={Math.max(1.5, bot - top)} /></g>; })}
    </svg></div>
    <div className="chart-legend"><span><i className="legend-green"></i> Bullish</span><span><i className="legend-red"></i> Bearish</span></div>
    <div className="mini-stat"><span>{sim.mode === 'live' && s.h24 ? '24 h bias' : 'Session bias'}</span><b className={bull ? 'up' : 'down'}>{bull ? 'Bullish' : 'Bearish'} <span className="sentiment-bar"><i style={{ width: `${Math.min(100, 50 + Math.abs(p) * 25)}%`, background: bull ? '#35d99f' : '#ff6577' }} /></span></b></div>
    <div className="mini-stat"><span>Data</span><b>{sim.mode === 'live' ? <><span className="live-dot"></span> Deriv live · 10 s candles</> : 'Simulated ticks'}</b></div>
    <div className="panel-foot">{sim.mode === 'live' ? 'Live ticks from Deriv\'s public feed.' : 'Simulated chart, not live market data.'} Pick a market on the left.</div></aside>;
}
