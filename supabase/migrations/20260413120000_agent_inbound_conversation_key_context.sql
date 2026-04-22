-- Legacy rows used conversation_key = sender_user_id only, so every message from one sender
-- updated a single row. Gateway now keys by sender_id + A2A contextId (see a2a-gateway).
-- Remove stale legacy rows to avoid duplicate request cards next to new sender:context rows.
DELETE FROM public.agent_inbound_notifications
WHERE sender_user_id IS NOT NULL
  AND conversation_key = sender_user_id::text;
