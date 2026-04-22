-- Globally unique public agent usernames (slugs) for discovery.
-- Replaces partial unique index so two users cannot claim the same slug (even if one row is disabled).

drop index if exists discoverable_user_agents_slug_idx;

-- Existing data may have duplicate slugs (e.g. same default from name). Resolve before unique index.
-- Keeps one row per lower(slug): earliest updated_at, then user_id, then user_agent_id.
-- Others get slug "<original>-<10 hex chars>" derived from (user_id, user_agent_id), stable and unique.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY lower(trim(slug))
      ORDER BY updated_at ASC NULLS LAST, user_id ASC, user_agent_id ASC
    ) AS rn
  FROM public.discoverable_user_agents
)
UPDATE public.discoverable_user_agents AS t
SET slug = regexp_replace(
  trim(t.slug) || '-' || substr(md5(t.user_id::text || '|' || t.user_agent_id::text), 1, 10),
  '[^a-z0-9-]',
  '-',
  'gi'
)
FROM ranked AS r
WHERE t.ctid = r.ctid
  AND r.rn > 1;

create unique index if not exists discoverable_user_agents_slug_lower_unique
  on public.discoverable_user_agents (lower(slug));

-- Callable by anon (before signup) and authenticated users to validate a chosen username.
create or replace function public.is_agent_username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.discoverable_user_agents
    where length(trim(candidate)) > 0
      and lower(trim(slug)) = lower(trim(candidate))
  );
$$;

grant execute on function public.is_agent_username_available(text) to anon, authenticated;
