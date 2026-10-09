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
