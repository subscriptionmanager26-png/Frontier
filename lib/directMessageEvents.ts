import { supabase } from '@/lib/supabase';

/** Matches `AgentUiMessage` shape from `hooks/useAgent` (avoid circular import). */
export type DirectMessageUiLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  taskId?: string;
};

export type DirectMessageEventRow = {
  id: string;
  user_id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  source: 'gateway' | 'client';
  dedupe_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function eventRowToUiMessage(row: DirectMessageEventRow): DirectMessageUiLine {
  const inbound = row.direction === 'inbound';
  return {
    id: `dme-${row.id}`,
    role: inbound ? 'assistant' : 'user',
    text: row.body,
    taskId: typeof row.metadata?.taskId === 'string' ? row.metadata.taskId : undefined,
  };
}

/** Load transcript rows for the signed-in user and thread (ordered oldest → newest). */
export async function fetchDirectMessageEvents(threadId: string): Promise<DirectMessageUiLine[]> {
  if (!supabase) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return [];
  const { data, error } = await supabase
    .from('direct_message_events')
    .select('id, user_id, thread_id, direction, body, source, dedupe_key, metadata, created_at')
    .eq('user_id', session.user.id)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return [];
  return (data as DirectMessageEventRow[]).map(eventRowToUiMessage);
}

export async function insertClientDirectMessageEvents(
  threadId: string,
  rows: Array<{
    direction: 'inbound' | 'outbound';
    body: string;
    dedupeKey: string;
    metadata?: Record<string, unknown>;
  }>
): Promise<void> {
  if (!supabase || rows.length === 0) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;
  const payload = rows.map((r) => ({
    user_id: uid,
    thread_id: threadId,
    direction: r.direction,
    body: r.body.slice(0, 20000),
    source: 'client' as const,
    dedupe_key: r.dedupeKey,
    metadata: r.metadata ?? {},
  }));
  const { error } = await supabase.from('direct_message_events').insert(payload);
  if (error?.code === '23505') return;
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[directMessageEvents] insert client rows failed', error.message);
  }
}

/** After a completed A2A turn: persist outbound user text + inbound assistant reply (this user's mailbox). */
export async function insertClientPairFromA2aTurn(args: {
  threadId: string;
  taskId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  const { threadId, taskId, userText, assistantText } = args;
  const t = taskId.trim();
  if (!t || !threadId.trim()) return;
  await insertClientDirectMessageEvents(threadId, [
    { direction: 'outbound', body: userText, dedupeKey: `client:out:${t}`, metadata: { taskId: t } },
    { direction: 'inbound', body: assistantText, dedupeKey: `client:in:${t}`, metadata: { taskId: t } },
  ]);
}
