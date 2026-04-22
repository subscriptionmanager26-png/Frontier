-- Owners can delete their own inbound notification rows (e.g. dismiss after replying in Direct).
drop policy if exists "agent_inbound_delete_own" on public.agent_inbound_notifications;

create policy "agent_inbound_delete_own"
  on public.agent_inbound_notifications
  for delete
  to authenticated
  using (auth.uid() = owner_user_id);

-- Deliver INSERT/UPDATE/DELETE to Realtime subscribers (RLS still filters per connected user).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_inbound_notifications'
  ) then
    alter publication supabase_realtime add table public.agent_inbound_notifications;
  end if;
end $$;
