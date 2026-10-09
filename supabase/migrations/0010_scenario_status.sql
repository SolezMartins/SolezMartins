-- Scenario state recorded when an auto trade signal is created: 'in_zone' | 'waiting' | 'do_not_chase'.
-- Powers the Performance tab's "By scenario status" table. Safe to run more than once.
-- Without it, signals are still journaled and tracked (needs 0009); they just carry no scenario status.
alter table trade_journal add column if not exists scenario_status text;
