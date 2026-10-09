-- Per-user settings (one row per user).
create table if not exists user_preferences (id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users on delete cascade,
  swing_left int not null default 3 check (swing_left between 2 and 6), swing_right int not null default 3 check (swing_right between 2 and 6),
  default_tf text, default_symbol text, notifications boolean not null default true, created_at timestamptz default now());
alter table user_preferences enable row level security;
create policy own_prefs on user_preferences for all using (user_id = auth.uid());
