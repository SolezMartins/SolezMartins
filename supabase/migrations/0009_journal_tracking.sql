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
