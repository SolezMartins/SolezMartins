-- ===== migrations/0001_core.sql =====
create table instruments (symbol text primary key, display_name text, market text, submarket text, pip numeric, is_open boolean, updated_at timestamptz default now());
create table candles (symbol text references instruments, timeframe text, ts timestamptz, open numeric, high numeric, low numeric, close numeric, primary key (symbol, timeframe, ts));
create table watchlists (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users not null, name text not null, is_default boolean default false);
create table watchlist_items (watchlist_id uuid references watchlists on delete cascade, symbol text references instruments, position int, primary key (watchlist_id, symbol));
create table alerts (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users not null, symbol text, kind text, params jsonb, active boolean default true);
create table trade_journal (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users not null, symbol text, direction text, entry numeric, stop numeric, target numeric, result text, strategy text, notes text, created_at timestamptz default now());
alter table watchlists enable row level security; alter table watchlist_items enable row level security; alter table alerts enable row level security; alter table trade_journal enable row level security;
create policy own_wl on watchlists for all using (user_id = auth.uid());
create policy own_wli on watchlist_items for all using (exists (select 1 from watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));
create policy own_alerts on alerts for all using (user_id = auth.uid());
create policy own_journal on trade_journal for all using (user_id = auth.uid());

-- ===== migrations/0002_auth_persistence.sql =====
-- App columns used by the API
alter table watchlists add column if not exists symbols text[] not null default '{}', add column if not exists created_at timestamptz default now();
alter table alerts add column if not exists tf text, add column if not exists level numeric, add column if not exists dir text,
  add column if not exists triggered_at timestamptz, add column if not exists created_at timestamptz default now();
alter table trade_journal add column if not exists lessons text;
create index if not exists alerts_active_idx on alerts (active) where active;

-- Profiles, created automatically on sign-up
create table if not exists profiles (id uuid primary key references auth.users on delete cascade, display_name text, created_at timestamptz default now());
alter table profiles enable row level security;
create policy own_profile on profiles for all using (id = auth.uid());
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Market tables: no anon writes. Only the service role (API) writes; signed-in users may read instruments.
alter table instruments enable row level security;
alter table candles enable row level security;
create policy read_instruments on instruments for select to authenticated using (true);

-- ===== migrations/0003_market_data_retention.sql =====
-- Candles are written by the API (service role); the FK is dropped so backfill never races instrument sync.
alter table candles drop constraint if exists candles_symbol_fkey;
create policy read_candles on candles for select to authenticated using (true);

-- Raw ticks are optional (PERSIST_TICKS=true) and short-lived.
create table if not exists ticks (symbol text not null, ts timestamptz not null, quote numeric not null);
create index if not exists ticks_symbol_ts on ticks (symbol, ts desc);
create index if not exists ticks_ts on ticks (ts);
alter table ticks enable row level security;

-- Retention: ticks by hours; candles by timeframe band. Called every 6h by the API.
create or replace function prune_market_data(tick_hours int default 24, short_days int default 30, mid_days int default 180, long_days int default 730)
returns void language sql as $$
  delete from ticks where ts < now() - make_interval(hours => tick_hours);
  delete from candles where timeframe in ('1m','2m','5m') and ts < now() - make_interval(days => short_days);
  delete from candles where timeframe in ('15m','30m','1h') and ts < now() - make_interval(days => mid_days);
  delete from candles where timeframe in ('2h','4h','1d') and ts < now() - make_interval(days => long_days);
$$;
revoke all on function prune_market_data(int, int, int, int) from public, anon, authenticated;
grant execute on function prune_market_data(int, int, int, int) to service_role;

-- ===== migrations/0004_backtests_chat.sql =====
-- Saved backtest runs (written only by the API from real engine output) and saved AI chat history.
create table if not exists backtest_runs (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  symbol text not null, tf text not null, rules jsonb not null, result jsonb not null, created_at timestamptz default now());
create table if not exists ai_conversations (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  title text, created_at timestamptz default now());
create table if not exists ai_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references ai_conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade, role text not null check (role in ('user', 'assistant')),
  content text, notice text, context jsonb, snapshots jsonb, created_at timestamptz default now());
create index if not exists backtest_runs_user on backtest_runs (user_id, created_at desc);
create index if not exists ai_conversations_user on ai_conversations (user_id, created_at desc);
create index if not exists ai_messages_conv on ai_messages (conversation_id, created_at);
alter table backtest_runs enable row level security; alter table ai_conversations enable row level security; alter table ai_messages enable row level security;
create policy own_runs on backtest_runs for all using (user_id = auth.uid());
create policy own_convs on ai_conversations for all using (user_id = auth.uid());
create policy own_msgs on ai_messages for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- ===== migrations/0005_journal_screenshots.sql =====
-- Journal screenshots: private bucket, accessed only through the API (service role), 2 MB, images only.
alter table trade_journal add column if not exists screenshot text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-screenshots', 'journal-screenshots', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ===== migrations/0006_preferences.sql =====
-- Per-user settings (one row per user).
create table if not exists user_preferences (id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users on delete cascade,
  swing_left int not null default 3 check (swing_left between 2 and 6), swing_right int not null default 3 check (swing_right between 2 and 6),
  default_tf text, default_symbol text, notifications boolean not null default true, created_at timestamptz default now());
alter table user_preferences enable row level security;
create policy own_prefs on user_preferences for all using (user_id = auth.uid());

-- ===== migrations/0007_audit_logs.sql =====
-- Audit trail. No policies on purpose: only the service role (the API) can read or write it.
create table if not exists audit_logs (id bigint generated always as identity primary key, user_id uuid, action text not null, resource text, status int, ip text, meta jsonb, created_at timestamptz not null default now());
create index if not exists audit_logs_time on audit_logs (created_at desc);
create index if not exists audit_logs_user on audit_logs (user_id, created_at desc);
alter table audit_logs enable row level security;
create or replace function prune_audit_logs(keep_days int default 365) returns void language sql as $$
  delete from audit_logs where created_at < now() - make_interval(days => keep_days);
$$;
revoke all on function prune_audit_logs(int) from public, anon, authenticated;
grant execute on function prune_audit_logs(int) to service_role;

-- ===== migrations/0008_analysis_tables.sql =====
-- Persisted analysis (written by the API's ingest process with the service role; signed-in users get read-only access).
alter table instruments add column if not exists category text, add column if not exists slug text;
create table if not exists market_categories (id text primary key, name text not null, updated_at timestamptz default now());
create table if not exists market_data_sources (id text primary key, name text not null, kind text not null, status text not null default 'active', last_seen timestamptz, updated_at timestamptz default now());
create table if not exists indicator_values (symbol text, timeframe text, ts timestamptz, ema20 double precision, ema50 double precision, ema100 double precision, ema200 double precision, sma50 double precision, rsi double precision,
  macd_hist double precision, atr double precision, avg_range double precision, roc10 double precision, volatility_ratio double precision, primary key (symbol, timeframe, ts));
create table if not exists market_structures (symbol text, timeframe text, ts timestamptz, structure text, htf_structure text, range_state text, volatility text, labels text[], last_break text, primary key (symbol, timeframe, ts));
create table if not exists swing_points (symbol text, timeframe text, ts timestamptz, type text, price double precision, confirmed_at timestamptz, primary key (symbol, timeframe, ts, type));
create table if not exists liquidity_zones (symbol text, timeframe text, type text, price double precision, first_seen timestamptz, primary key (symbol, timeframe, type, price));
create table if not exists liquidity_events (symbol text, timeframe text, ts timestamptz, direction text, level double precision, confirmation text, reaction_5_pct double precision, primary key (symbol, timeframe, ts, direction));
create table if not exists supply_demand_zones (symbol text, timeframe text, ts timestamptz, direction text, upper double precision, lower double precision, strength double precision, tests int, status text, primary key (symbol, timeframe, ts, direction));
create table if not exists fair_value_gaps (symbol text, timeframe text, ts timestamptz, direction text, upper double precision, lower double precision, fill_pct double precision, filled boolean, primary key (symbol, timeframe, ts, direction));
create table if not exists price_action_zones (symbol text, timeframe text, ts timestamptz, direction text, upper double precision, lower double precision, base_ts timestamptz, retests int, status text, primary key (symbol, timeframe, ts, direction));
create table if not exists market_biases (symbol text, timeframe text, ts timestamptz, bias text, momentum text, ema_alignment text, primary key (symbol, timeframe, ts));
create table if not exists confluence_scores (symbol text, timeframe text, ts timestamptz, score int, parts jsonb, primary key (symbol, timeframe, ts));
create table if not exists analysis_snapshots (symbol text, timeframe text, ts timestamptz, snapshot jsonb, primary key (symbol, timeframe, ts));
create table if not exists potential_setups (id uuid primary key, symbol text not null, timeframe text not null, created_ts timestamptz not null, direction text not null, entry_kind text, entry_lower double precision, entry_upper double precision,
  invalidation double precision, target1 double precision, target2 double precision, estimated_rr double precision, status text not null default 'open', reasons jsonb, updated_at timestamptz default now());
create index if not exists potential_setups_lookup on potential_setups (symbol, timeframe, created_ts desc);
create table if not exists setup_events (id bigint generated always as identity primary key, setup_id uuid not null references potential_setups on delete cascade, ts timestamptz not null, event text not null, price double precision);
create index if not exists setup_events_setup on setup_events (setup_id);
-- AI explanations saved per user
create table if not exists analysis_reports (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, symbol text not null, timeframe text, snapshot jsonb, explanation text, created_at timestamptz default now());
alter table analysis_reports enable row level security;
create policy own_reports on analysis_reports for all using (user_id = auth.uid());
do $$ declare t text; begin
  foreach t in array array['market_categories','market_data_sources','indicator_values','market_structures','swing_points','liquidity_zones','liquidity_events','supply_demand_zones','fair_value_gaps','price_action_zones','market_biases','confluence_scores','analysis_snapshots','potential_setups','setup_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', 'read_' || t, t);
  end loop; end $$;
-- Retention: time series (per-candle) vs events/zones/setups. Open setups older than 3 days are marked expired.
create or replace function prune_analysis_data(series_days int default 90, event_days int default 365) returns void language sql as $$
  delete from indicator_values where ts < now() - make_interval(days => series_days);
  delete from market_structures where ts < now() - make_interval(days => series_days);
  delete from market_biases where ts < now() - make_interval(days => series_days);
  delete from confluence_scores where ts < now() - make_interval(days => series_days);
  delete from analysis_snapshots where ts < now() - make_interval(days => series_days);
  delete from swing_points where ts < now() - make_interval(days => event_days);
  delete from liquidity_zones where first_seen < now() - make_interval(days => event_days);
  delete from liquidity_events where ts < now() - make_interval(days => event_days);
  delete from supply_demand_zones where ts < now() - make_interval(days => event_days);
  delete from fair_value_gaps where ts < now() - make_interval(days => event_days);
  delete from price_action_zones where ts < now() - make_interval(days => event_days);
  update potential_setups set status = 'expired', updated_at = now() where status = 'open' and created_ts < now() - interval '3 days';
  delete from potential_setups where created_ts < now() - make_interval(days => event_days);
$$;
revoke all on function prune_analysis_data(int, int) from public, anon, authenticated;
grant execute on function prune_analysis_data(int, int) to service_role;

-- ===== migrations/0009_journal_tracking.sql =====
-- Outcome tracking for auto-journaled trade signals (pending -> filled -> win / loss / expired, or missed).
-- Safe to run more than once. Without it, signals are still journaled but outcomes are not tracked automatically.
alter table trade_journal
  add column if not exists source text,            -- 'signal' for entries created by Trade signal alerts; null for manual entries
  add column if not exists tf text,                -- timeframe the signal was generated on
  add column if not exists confluence numeric,     -- confluence score at signal time
  add column if not exists entry_status text,      -- 'pending' (limit order waiting) | 'filled' | 'done'
  add column if not exists filled_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists exit_price numeric,
  add column if not exists r_multiple numeric;     -- measured R at exit (stop gaps can be worse than -1)
create index if not exists trade_journal_open_signals on trade_journal (entry_status) where source = 'signal' and entry_status in ('pending', 'filled');

-- ===== migrations/0010_scenario_status.sql =====
-- Scenario state recorded when an auto trade signal is created: 'in_zone' | 'waiting' | 'do_not_chase'.
-- Powers the Performance tab's "By scenario status" table. Safe to run more than once.
-- Without it, signals are still journaled and tracked (needs 0009); they just carry no scenario status.
alter table trade_journal add column if not exists scenario_status text;
