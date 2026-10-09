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
