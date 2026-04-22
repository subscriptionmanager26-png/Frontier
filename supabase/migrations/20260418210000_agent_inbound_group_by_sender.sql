-- One Requests row per authenticated sender (peer), not per A2A UI thread / context.
-- Anonymous senders stay keyed by conversation_key (anon:<contextId>).

-- Merge unread counts onto the keeper row (latest updated_at) per (owner, agent_slug, sender).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY owner_user_id, agent_slug, sender_user_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
    ) AS rn,
    SUM(COALESCE(unread_count, 0)) OVER (PARTITION BY owner_user_id, agent_slug, sender_user_id) AS total_unread
  FROM public.agent_inbound_notifications
  WHERE sender_user_id IS NOT NULL
)
UPDATE public.agent_inbound_notifications n
SET unread_count = r.total_unread
FROM ranked r
WHERE n.id = r.id
  AND r.rn = 1;

-- Drop duplicate sender rows (keep latest by updated_at).
DELETE FROM public.agent_inbound_notifications
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY owner_user_id, agent_slug, sender_user_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
      ) AS rn
    FROM public.agent_inbound_notifications
    WHERE sender_user_id IS NOT NULL
  ) x
  WHERE x.rn > 1
);

ALTER TABLE public.agent_inbound_notifications
  DROP CONSTRAINT IF EXISTS agent_inbound_notifications_owner_slug_conv_unique;

CREATE UNIQUE INDEX IF NOT EXISTS agent_inbound_notifications_owner_slug_sender_unique
  ON public.agent_inbound_notifications (owner_user_id, agent_slug, sender_user_id)
  WHERE sender_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_inbound_notifications_owner_slug_conv_anon_unique
  ON public.agent_inbound_notifications (owner_user_id, agent_slug, conversation_key)
  WHERE sender_user_id IS NULL;
