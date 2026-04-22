-- Per-user A2A UI state: tracked subscriptions, updates feed, task log mirror (Tasks tab).
create table if not exists public.user_a2a_device_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"v":1}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_a2a_device_state enable row level security;

create policy "user_a2a_device_state_select_own"
on public.user_a2a_device_state
for select
to authenticated
using (auth.uid() = user_id);

create policy "user_a2a_device_state_insert_own"
on public.user_a2a_device_state
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "user_a2a_device_state_update_own"
on public.user_a2a_device_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
