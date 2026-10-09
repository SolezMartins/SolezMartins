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
