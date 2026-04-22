import type { AgentUiMessage } from '@/hooks/useAgent';
import { supabase } from '@/lib/supabase';
import { logUxFlow } from '@/lib/uxFlowLog';

type CloudRow = {
  thread_id: string;
  payload_json: AgentUiMessage[];
  updated_at: string;
};

export async function loadCloudMessages(threadId: string): Promise<AgentUiMessage[] | null> {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from('channel_messages')
    .select('thread_id,payload_json,updated_at')
    .eq('thread_id', threadId)
    .eq('user_id', session.user.id)
    .maybeSingle<CloudRow>();
  const rows = Array.isArray(data?.payload_json) ? (data.payload_json as AgentUiMessage[]) : null;
  await logUxFlow('ux.flow.messages.cloud_pull', {
    userId: session.user.id,
    threadId,
    ok: !error && !!data,
    messageCount: rows?.length ?? 0,
    error: error?.message ?? null,
    note: 'Loads channel_messages for current user only; other accounts do not see this row.',
  });
  if (error || !data) return null;
  /** Empty cloud backup must not win over newer local-only rows (e.g. inbound preview seed). */
  if (!rows || rows.length === 0) return null;
  return rows;
}

export async function saveCloudMessages(threadId: string, messages: AgentUiMessage[]): Promise<void> {
  if (!supabase) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return;
  const { error } = await supabase.from('channel_messages').upsert(
    {
      user_id: session.user.id,
      thread_id: threadId,
      payload_json: messages,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,thread_id' }
  );
  await logUxFlow('ux.flow.messages.cloud_push', {
    userId: session.user.id,
    threadId,
    messageCount: messages.length,
    ok: !error,
    error: error?.message ?? null,
  });
}
