create table if not exists public.discoverable_user_agents (
  user_id uuid not null references auth.users(id) on delete cascade,
  user_agent_id text not null,
  slug text not null,
  display_name text not null,
  card_json jsonb not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, user_agent_id)
);

-- Slug is globally unique (see migrations/20260410120000_agent_username_unique.sql).
create unique index if not exists discoverable_user_agents_slug_lower_unique
on public.discoverable_user_agents (lower(slug));

alter table public.discoverable_user_agents enable row level security;

create policy "discoverable_agents_select_public_enabled"
on public.discoverable_user_agents
for select
to authenticated, anon
using (enabled = true);

create policy "discoverable_agents_select_own"
on public.discoverable_user_agents
for select
to authenticated
using (auth.uid() = user_id);

create policy "discoverable_agents_insert_own"
on public.discoverable_user_agents
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "discoverable_agents_update_own"
on public.discoverable_user_agents
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
