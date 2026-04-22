import { supabase } from '@/lib/supabase';

/** Matches `AgentUiMessage` shape from `hooks/useAgent` (avoid circular import). */
export type DirectMessageUiLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  taskId?: string;
  /** A2A v1: logical session grouping (same across turns in one UI thread). */
  contextId?: string | null;
  /** A2A v1 `Message.referenceTaskIds` when present on the wire. */
  referenceTaskIds?: string[];
  /** A2A v1 `Message.messageId` when present (gateway / client may store in metadata). */
  a2aMessageId?: string | null;
  /**
   * UI-only tree link (which local message this one nests under in the hub).
   * Not an A2A field; A2A uses `contextId` + `referenceTaskIds` on `Message`.
   */
  replyToId?: string | null;
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

function metaString(m: Record<string, unknown>, key: string): string | null {
  const v = m[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function metaStringArray(m: Record<string, unknown>, key: string): string[] {
  const v = m[key];
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

function eventRowToUiMessage(row: DirectMessageEventRow): DirectMessageUiLine {
  const inbound = row.direction === 'inbound';
  const m = row.metadata || {};
  return {
    id: `dme-${row.id}`,
    role: inbound ? 'assistant' : 'user',
    text: row.body,
    taskId: typeof m.taskId === 'string' ? m.taskId : undefined,
    contextId: metaString(m, 'contextId'),
    referenceTaskIds: metaStringArray(m, 'referenceTaskIds'),
    a2aMessageId: metaString(m, 'a2aMessageId'),
  };
}

/**
 * One hub thread per A2A `contextId`: chain consecutive rows (same context) with `replyToId`
 * so `listThreadRoots` shows a single thread.
 */
function chainLinesByContextId(
  rows: DirectMessageEventRow[],
  lines: DirectMessageUiLine[]
): DirectMessageUiLine[] {
  if (rows.length !== lines.length || rows.length === 0) return lines;
  const sortedIdx = rows
    .map((r, i) => ({ i, t: new Date(r.created_at).getTime() || 0 }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.i);
  let lastIdByContext = new Map<string, string>();
  const out = lines.map((l) => ({ ...l }));
  for (const idx of sortedIdx) {
    const row = rows[idx]!;
    const line = out[idx]!;
    const ctx = line.contextId?.trim() || '';
    if (!ctx) continue;
    const prev = lastIdByContext.get(ctx);
    if (prev) {
      line.replyToId = prev;
    }
    lastIdByContext.set(ctx, line.id);
  }
  return out;
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
  const rows = data as DirectMessageEventRow[];
  const lines = rows.map(eventRowToUiMessage);
  return chainLinesByContextId(rows, lines);
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
  /** A2A v1 context id for this Direct thread (same across turns). */
  contextId?: string | null;
  referenceTaskIds?: string[];
}): Promise<void> {
  const { threadId, taskId, userText, assistantText, contextId, referenceTaskIds } = args;
  const t = taskId.trim();
  if (!t || !threadId.trim()) return;
  const baseMeta = {
    taskId: t,
    ...(contextId?.trim() ? { contextId: contextId.trim() } : {}),
    ...(referenceTaskIds?.length ? { referenceTaskIds } : {}),
  };
  await insertClientDirectMessageEvents(threadId, [
    {
      direction: 'outbound',
      body: userText,
      dedupeKey: `client:out:${t}`,
      metadata: { ...baseMeta },
    },
    {
      direction: 'inbound',
      body: assistantText,
      dedupeKey: `client:in:${t}`,
      metadata: { ...baseMeta },
    },
  ]);
}
