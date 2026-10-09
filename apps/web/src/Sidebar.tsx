import { useEffect, useMemo, useState, type ComponentType, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LogOut, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavItem = readonly [id: string, label: string, Icon: ComponentType<{ className?: string }>];
const KEY = 'mp.sidebar.collapsed';
const read = () => { try { const v = localStorage.getItem(KEY); if (v !== null) return v === '1'; } catch { /* storage blocked */ } return typeof window !== 'undefined' && window.innerWidth < 900; };

/** Floating glass sidebar: brand and collapse button, account row, search, labelled sections, solid accent pill on the active page. */
export function Sidebar({ items, groups, active, onSelect, badges = {}, email, onSignOut }: {
  items: readonly NavItem[]; groups: { label: string; ids: string[] }[]; active: string; onSelect: (id: string) => void;
  badges?: Record<string, number>; email?: string | null; onSignOut?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(read), [q, setQ] = useState(''), [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  // Collapsed rail: hovering or focusing an icon shows its page name beside it. Fixed-position and portalled, so the rail's overflow clipping cannot cut it off.
  const showTip = (text: string) => (e: SyntheticEvent<HTMLElement>) => { if (!collapsed) return; const r = e.currentTarget.getBoundingClientRect(); setTip({ text, top: r.top + r.height / 2, left: r.right + 12 }); };
  const hideTip = () => setTip(null);
  useEffect(() => { if (!collapsed) setTip(null); }, [collapsed]);
  useEffect(() => { try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  const byId = useMemo(() => new Map(items.map(i => [i[0], i] as const)), [items]), term = q.trim().toLowerCase();
  const name = email ? email.split('@')[0] : 'Guest';
  const row = (id: string) => {
    const it = byId.get(id); if (!it) return null; const [, label, Icon] = it, on = active === id, n = badges[id] ?? 0;
    return <button key={id} type="button" aria-label={collapsed ? label : undefined} onMouseEnter={showTip(label)} onFocus={showTip(label)} onMouseLeave={hideTip} onBlur={hideTip} onClick={() => { hideTip(); onSelect(id); }} aria-current={on ? 'page' : undefined}
      className={cn('sb-item group relative flex h-10 w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-[13px] font-medium', on ? 'sb-active' : 'text-muted-foreground hover:bg-white/[.06] hover:text-foreground', collapsed ? 'justify-center px-0' : 'justify-start')}>
      <span className={cn('sb-ico grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors', !on && 'group-hover:bg-white/10')}><Icon className="h-4 w-4" /></span>
      {!collapsed && <span className="truncate">{label}</span>}
      {n > 0 && (collapsed ? <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-[#0a1220]" /> : <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{n > 99 ? '99+' : n}</span>)}
    </button>;
  };
  const groupsShown = groups.map(g => ({ ...g, ids: g.ids.filter(id => !term || byId.get(id)?.[1].toLowerCase().includes(term)) })).filter(g => g.ids.length);
  return <aside className={cn('sb glass flex shrink-0 flex-col overflow-hidden rounded-2xl', collapsed ? 'w-[72px]' : 'w-64')} aria-label="Main navigation">
    <div className={cn('flex h-16 shrink-0 items-center gap-2 px-4', collapsed && 'justify-center px-0')}>
      {collapsed ? <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#0879f2] to-[#0c9dff] text-sm font-bold text-white">D</span>
        : <><span className="text-[15px] font-semibold tracking-tight">Deriv <span className="text-primary">MI</span></span>
          <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" className="ml-auto h-8 gap-1 rounded-full border-white/10 bg-white/5 px-3 text-[11px] text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" />Collapse</button></>}
    </div>
    {collapsed && <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand sidebar" onMouseEnter={showTip('Expand sidebar')} onFocus={showTip('Expand sidebar')} onMouseLeave={hideTip} onBlur={hideTip} className="mx-auto mb-2 h-8 w-8 rounded-full border-white/10 bg-white/5 p-0 text-muted-foreground hover:text-foreground"><ChevronRight className="h-3.5 w-3.5" /></button>}
    <div className={cn('mx-3 mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.04] p-2.5', collapsed && 'mx-auto w-11 justify-center p-1.5')} onMouseEnter={showTip(email ?? 'Account')} onMouseLeave={hideTip}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-500/60 to-slate-700/60 text-sm font-semibold uppercase ring-1 ring-white/20">{name[0]}</span>
      {!collapsed && <span className="min-w-0 leading-tight"><b className="block truncate text-[13px] font-semibold">{name}</b><small className="block truncate text-[11px]">{email ?? 'Signed in'}</small></span>}
    </div>
    {!collapsed && <label className="mx-3 mb-2 flex h-9 items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 text-muted-foreground focus-within:border-primary/60"><Search className="h-3.5 w-3.5 shrink-0" />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search pages" aria-label="Search pages" className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs uppercase tracking-wider text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-0" /></label>}
    <nav className="sb-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
      {groupsShown.map((g, gi) => <div key={g.label} className={cn(gi > 0 && 'mt-3 border-t border-white/[.07] pt-3')}>
        {!collapsed && g.label && <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground/80">{g.label}</div>}
        <div className="space-y-0.5">{g.ids.map(row)}</div></div>)}
      {!groupsShown.length && <p className="px-3 py-2 text-xs text-muted-foreground">No pages match.</p>}
    </nav>
    {onSignOut && <div className="border-t border-white/[.07] p-2"><button type="button" onClick={onSignOut} aria-label={collapsed ? 'Sign out' : undefined} onMouseEnter={showTip('Sign out')} onFocus={showTip('Sign out')} onMouseLeave={hideTip} onBlur={hideTip} className={cn('sb-item flex h-10 w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-[13px] font-medium text-muted-foreground hover:bg-white/[.06] hover:text-foreground', collapsed ? 'justify-center px-0' : 'justify-start')}>
      <span className="grid h-7 w-7 place-items-center"><LogOut className="h-4 w-4" /></span>{!collapsed && 'Sign out'}</button></div>}
    {!collapsed && <p className="px-5 pb-3 text-[10px] leading-snug text-muted-foreground/70">Analysis only. No trades are placed for you.</p>}
  {tip && createPortal(<div role="tooltip" className="sb-tip" style={{ top: tip.top, left: tip.left }}>{tip.text}</div>, document.body)}
  </aside>;
}
