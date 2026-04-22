-- Allow users to delete their own discoverable rows so a new local user_agent_id can reclaim the same slug
-- after sign-out wiped AsyncStorage (PK is user_id + user_agent_id; slug is globally unique).

create policy "discoverable_agents_delete_own"
  on public.discoverable_user_agents
  for delete
  to authenticated
  using (auth.uid() = user_id);
