create table if not exists public.channel_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id text not null,
  payload_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

alter table public.channel_messages enable row level security;

create policy "channel_messages_select_own"
on public.channel_messages
for select
to authenticated
using (auth.uid() = user_id);

create policy "channel_messages_insert_own"
on public.channel_messages
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "channel_messages_update_own"
on public.channel_messages
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
