-- Public directory entries are always listed when a row exists; there is no user-controlled "off" flag.
-- Backfill legacy rows that were synced with enabled = false.

update public.discoverable_user_agents
set enabled = true
where enabled is distinct from true;
