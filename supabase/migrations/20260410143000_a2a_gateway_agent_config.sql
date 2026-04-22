-- Runtime routing + on-platform agent brain. NOT exposed to anon (unlike discoverable_user_agents).
-- Edge Function uses service role to read this table.
--
-- Routing rule:
--   downstream_url IS NOT NULL  -> proxy JSON-RPC to that URL (off-platform brain).
--   downstream_url IS NULL      -> run in Edge Function using system_prompt / model / tools (on-platform).

create table if not exists public.a2a_gateway_agent_config (
  slug text not null,
  downstream_url text,
  system_prompt text,
  model text,
  tools jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (slug),
  constraint a2a_gateway_agent_config_slug_lower_ck check (slug = lower(slug))
);

create index if not exists a2a_gateway_agent_config_downstream_idx
  on public.a2a_gateway_agent_config (downstream_url)
  where downstream_url is not null;

comment on table public.a2a_gateway_agent_config is
  'A2A gateway routing: slug -> off-platform downstream_url or on-platform LLM config. Read from Edge Function with service role only.';

comment on column public.a2a_gateway_agent_config.downstream_url is
  'If set, gateway proxies JSON-RPC to this base (e.g. https://host/a2a/v1/slug). If null, gateway runs agent in-process.';

alter table public.a2a_gateway_agent_config enable row level security;

-- No policies: JWT clients cannot read brain config. Service role bypasses RLS for Edge Functions.
