-- When user A messages user B's agent (on-platform gateway), B sees it under Direct → Requests
-- without searching. Rows are written by the a2a-gateway Edge Function (service role).

create table if not exists public.agent_inbound_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  agent_slug text not null,
  conversation_key text not null,
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_label text not null default 'Someone',
  sender_agent_rpc_url text,
  last_preview text not null default '',
  last_task_id text,
  unread_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_inbound_notifications_owner_slug_conv_unique unique (owner_user_id, agent_slug, conversation_key)
);

create index if not exists agent_inbound_notifications_owner_updated_idx
  on public.agent_inbound_notifications (owner_user_id, updated_at desc);

comment on table public.agent_inbound_notifications is
  'In-app inbox for owners: someone messaged your discoverable agent (see a2a-gateway).';

alter table public.agent_inbound_notifications enable row level security;

create policy "agent_inbound_select_own"
  on public.agent_inbound_notifications
  for select
  to authenticated
  using (auth.uid() = owner_user_id);

create policy "agent_inbound_update_own"
  on public.agent_inbound_notifications
  for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

-- Inserts only from Edge Function (service role), not from clients.
