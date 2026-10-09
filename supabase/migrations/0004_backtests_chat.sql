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
