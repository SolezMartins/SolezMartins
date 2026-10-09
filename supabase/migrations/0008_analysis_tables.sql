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
