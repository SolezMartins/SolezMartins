import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import './login.css';
import { ChartPanel, WatchPanel, useSim } from './LoginMarkets';

const Icon = ({ d, children }: { d?: string; children?: any }) => <svg viewBox="0 0 24 24">{d ? <path d={d} /> : children}</svg>;
const clock = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' UTC';

/** Shared frame: market-themed background, the two decorative market panels (live Deriv ticks, or a labelled simulation if the feed is unreachable) and the footer. */
function Frame({ children }: { children: any }) {
  const [t, setT] = useState(clock()), sim = useSim();
  useEffect(() => { const i = setInterval(() => setT(clock()), 1000); return () => clearInterval(i); }, []);
  return <div className="lg"><div className="app-shell"><div className="market-grid" aria-hidden="true"></div>
    <header className="topbar"><div className="brand"><span className="brand-mark"><svg viewBox="0 0 32 32"><path d="M4 23 12 15l5 4 10-12M20 7h7v7"/></svg></span><span>DERIV <span className="brand-accent">MARKET INTELLIGENCE</span><small>ANALYSIS TERMINAL</small></span></div><div className="market-status"><span className="live-dot"></span> <span className="clock">{t}</span></div></header>
    <main className="main-layout">
      <WatchPanel sim={sim} />
      {children}
      <ChartPanel sim={sim} />
    </main>
    <footer className="site-footer"><div><span className="footer-icon">◇</span><span><b>Secure access</b><small>Your session is encrypted</small></span></div><i></i><div><span className="footer-icon">↗</span><span><b>Analysis only</b><small>No trades are placed for you</small></span></div><i></i><div><span className="footer-icon">⌁</span><span><b>Risk awareness</b><small>Trading involves risk</small></span></div></footer>
    <p className="disclaimer">{sim.mode === 'live' ? 'Prices on the sides are live Deriv synthetic index ticks. Analysis only, not financial advice.' : 'Prices on the sides are simulated and are not market data. Analysis only, not financial advice.'}</p>
  </div></div>;
}

/** Sign in / create account with Supabase email + password. Forgot password sends a Supabase reset link (see NewPassword). */
export function Login({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [show, setShow] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ t: string; err?: boolean }>({ t: '' });
  const login = mode === 'login', min = login ? 6 : 8, [armed, setArmed] = useState(false); // register fields stay read-only until focused so the browser cannot autofill saved logins into them
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMsg({ t: 'Enter a valid email address.', err: true });
    if (!pw) return setMsg({ t: 'Enter your password.', err: true });
    if (pw.length < min) return setMsg({ t: `Password must be at least ${min} characters.`, err: true });
    setBusy(true); setMsg({ t: '' });
    try {
      if (login) { const r = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw }); if (r.error) setMsg({ t: r.error.message, err: true }); }
      else { const r = await supabase.auth.signUp({ email: email.trim(), password: pw }); if (r.error) setMsg({ t: r.error.message, err: true }); else if (!r.data.session) setMsg({ t: 'Check your email to confirm your account, then sign in.' }); }
    } catch (err: any) { setMsg({ t: err?.message ?? 'Could not reach the sign-in service. Try again.', err: true }); }
    setBusy(false);
  };
  const forgot = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMsg({ t: 'Enter your email address above first, then press Forgot password.', err: true });
    const r = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setMsg(r.error ? { t: r.error.message, err: true } : { t: 'If that email has an account, a reset link is on its way.' });
  };
  const tab = (m: 'login' | 'register') => { setMode(m); setMsg({ t: '' }); setArmed(false); if (m === 'register') { setEmail(''); setPw(''); setShow(false); } };
  return <Frame><section className="login-card" aria-labelledby="lg-heading">
    <div className="card-top"><span className="secure-chip"><Icon><path d="M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></Icon> SECURE ACCESS</span></div>
    <div className="hero-icon"><svg viewBox="0 0 72 72" aria-hidden="true"><path className="chart-axis" d="M8 59H64M12 59V12"/><path className="chart-line" d="m15 48 12-13 10 6 12-19 8 5 7-15"/><path className="chart-arrow" d="M54 12h10v10"/><rect x="17" y="38" width="5" height="13" rx="1"/><rect x="29" y="28" width="5" height="17" rx="1"/><rect x="41" y="32" width="5" height="12" rx="1"/><rect x="53" y="21" width="5" height="14" rx="1"/></svg></div>
    <div key={mode} className="swap"><p className="eyebrow">YOUR TRADING WORKSPACE</p><h1 id="lg-heading">{login ? <>Welcome <span>back.</span></> : <>Create your <span>account.</span></>}</h1><p className="subtitle">{login ? 'Sign in to access your trading dashboard.' : 'Register with your email to get started.'}</p></div>
    <div className="tabs" role="tablist" aria-label="Account access"><button className={'tab' + (login ? ' active' : '')} role="tab" aria-selected={login} type="button" onClick={() => tab('login')}>Sign in</button><button className={'tab' + (!login ? ' active' : '')} role="tab" aria-selected={!login} type="button" onClick={() => tab('register')}>Create account</button></div>
    <form onSubmit={submit} noValidate>
      <label htmlFor="lg-email">Email address</label><div className="input-box"><Icon><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.3 3.1-5 7-5s6.3 1.7 7 5" /></Icon><input key={mode + 'e'} id="lg-email" name={login ? 'email' : 'new-account-email'} type="email" autoComplete={login ? 'username' : 'off'} readOnly={!login && !armed} onFocus={() => setArmed(true)} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="label-line"><label htmlFor="lg-pw">Password</label>{login && <button type="button" className="linklike" onClick={forgot}>Forgot password?</button>}</div>
      <div className="input-box"><Icon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon><input key={mode + 'p'} id="lg-pw" name={login ? 'password' : 'new-account-password'} type={show ? 'text' : 'password'} autoComplete={login ? 'current-password' : 'new-password'} readOnly={!login && !armed} onFocus={() => setArmed(true)} placeholder={login ? 'Enter your password' : 'At least 8 characters'} value={pw} onChange={e => setPw(e.target.value)} /><button type="button" className="reveal" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></Icon></button></div>
      <button className="submit-button" type="submit" disabled={busy}><span>{busy ? 'Please wait...' : login ? 'Sign in to terminal' : 'Create account'}</span><Icon d="M5 12h13M13 6l6 6-6 6" /></button>
      <p key={msg.t} className={'message' + (msg.err ? ' error shake' : '')} role="status" aria-live="polite">{msg.t}</p>
    </form>
  </section></Frame>;
}

/** Shown after the user opens a password-reset link from their email (Supabase PASSWORD_RECOVERY event). */
export function NewPassword({ supabase, done }: { supabase: SupabaseClient; done: () => void }) {
  const [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ t: string; err?: boolean }>({ t: '' });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (pw.length < 8) return setMsg({ t: 'Password must be at least 8 characters.', err: true });
    setBusy(true); const r = await supabase.auth.updateUser({ password: pw }); setBusy(false);
    if (r.error) setMsg({ t: r.error.message, err: true }); else done();
  };
  return <Frame><section className="login-card"><div className="card-top"><span className="secure-chip"><Icon><path d="M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></Icon> SECURE ACCESS</span></div>
    <div className="hero-icon"><svg viewBox="0 0 72 72" aria-hidden="true"><path className="chart-axis" d="M8 59H64M12 59V12"/><path className="chart-line" d="m15 48 12-13 10 6 12-19 8 5 7-15"/><path className="chart-arrow" d="M54 12h10v10"/><rect x="17" y="38" width="5" height="13" rx="1"/><rect x="29" y="28" width="5" height="17" rx="1"/><rect x="41" y="32" width="5" height="12" rx="1"/><rect x="53" y="21" width="5" height="14" rx="1"/></svg></div>
    <p className="eyebrow">RESET PASSWORD</p><h1>Choose a <span>new password.</span></h1><p className="subtitle">Use at least 8 characters.</p>
    <form onSubmit={submit} noValidate><label htmlFor="lg-new">New password</label><div className="input-box"><Icon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon><input id="lg-new" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
      <button className="submit-button" type="submit" disabled={busy}><span>{busy ? 'Saving...' : 'Save password'}</span></button><p className={'message' + (msg.err ? ' error' : '')} role="status" aria-live="polite">{msg.t}</p></form>
  </section></Frame>;
}
