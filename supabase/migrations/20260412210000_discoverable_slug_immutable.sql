-- Slug is set at account creation (email-derived) and must not change.

create or replace function public.prevent_discoverable_user_agents_slug_change()
returns trigger
language plpgsql
as $$
begin
  if old.slug is distinct from new.slug then
    raise exception 'discoverable_user_agents.slug is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_discoverable_slug_immutable on public.discoverable_user_agents;

create trigger trg_discoverable_slug_immutable
  before update on public.discoverable_user_agents
  for each row
  execute procedure public.prevent_discoverable_user_agents_slug_change();
