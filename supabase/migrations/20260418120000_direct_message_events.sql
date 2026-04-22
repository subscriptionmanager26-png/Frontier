-- Append-only transcript for Direct threads (on-platform gateway + client-observed off-platform A2A).
create table if not exists public.direct_message_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  source text not null check (source in ('gateway', 'client')),
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists direct_message_events_dedupe_uid_tid
  on public.direct_message_events (user_id, thread_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists direct_message_events_user_thread_created
  on public.direct_message_events (user_id, thread_id, created_at);

alter table public.direct_message_events enable row level security;

create policy "direct_message_events_select_own"
  on public.direct_message_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "direct_message_events_insert_own"
  on public.direct_message_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_message_events'
  ) then
    alter publication supabase_realtime add table public.direct_message_events;
  end if;
end $$;
