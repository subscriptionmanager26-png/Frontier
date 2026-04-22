import { canonicalA2aAgentUrl } from '@/lib/a2a/canonicalAgentUrl';
import { supabase } from '@/lib/supabase';
import { shortUserId } from '@/lib/uxFlowLog';

export type AgentInboundRow = {
  id: string;
  owner_user_id: string;
  agent_slug: string;
  conversation_key: string;
  sender_user_id: string | null;
  sender_label: string;
  sender_agent_rpc_url: string | null;
  last_preview: string;
  last_task_id: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

export async function fetchAgentInboundForOwner(): Promise<AgentInboundRow[]> {
  if (!supabase) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return [];
  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'sync-v1',hypothesisId:'H-B-H-C',location:'lib/agentInbound.ts:fetchAgentInboundForOwner',message:'inbound fetch start',data:{userShort:shortUserId(session.user.id)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const { data, error } = await supabase
    .from('agent_inbound_notifications')
    .select(
      'id, owner_user_id, agent_slug, conversation_key, sender_user_id, sender_label, sender_agent_rpc_url, last_preview, last_task_id, unread_count, created_at, updated_at'
    )
    .eq('owner_user_id', session.user.id)
    .order('updated_at', { ascending: false });
  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'sync-v1',hypothesisId:'H-B-H-C',location:'lib/agentInbound.ts:fetchAgentInboundForOwner',message:'inbound fetch result',data:{userShort:shortUserId(session.user.id),hasError:Boolean(error),rowCount:Array.isArray(data)?data.length:0,error:error?.message??null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (error || !data) return [];
  return data as AgentInboundRow[];
}

/**
 * Refetch-driven sync: Postgres notifies the client when this owner's inbound rows change,
 * so the Requests list stays current without staying on that screen (single-device account switches).
 */
export function subscribeAgentInboundChanges(
  ownerUserId: string,
  onChange: () => void,
  channelSuffix = 'sync'
): () => void {
  if (!supabase || !ownerUserId.trim()) return () => {};
  const uid = ownerUserId.trim();
  const channelName = `agent-inbound-${channelSuffix}-${uid}`;
  const ch = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'agent_inbound_notifications',
        filter: `owner_user_id=eq.${uid}`,
      },
      () => {
        // #region agent log
        fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'sync-v1',hypothesisId:'H-D',location:'lib/agentInbound.ts:subscribeAgentInboundChanges',message:'inbound postgres_changes fired',data:{userShort:shortUserId(uid)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        onChange();
      }
    )
    .subscribe((status, err) => {
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'sync-v1',hypothesisId:'H-D',location:'lib/agentInbound.ts:subscribeAgentInboundChanges',message:'inbound realtime subscribe status',data:{userShort:shortUserId(uid),status,errMsg:err?.message??null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    });
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function countUnreadAgentInbound(): Promise<number> {
  const rows = await fetchAgentInboundForOwner();
  return rows.reduce((s, r) => s + (r.unread_count > 0 ? r.unread_count : 0), 0);
}

export async function markAgentInboundRead(id: string): Promise<void> {
  if (!supabase) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return;
  await supabase
    .from('agent_inbound_notifications')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', session.user.id);
}

/** After owner replies in Direct, remove the corresponding request row by sender RPC URL. */
export async function dismissAgentInboundBySenderRpcUrl(senderRpcUrl: string): Promise<void> {
  if (!supabase) return;
  const normalized = canonicalA2aAgentUrl(senderRpcUrl.trim()) || senderRpcUrl.trim().replace(/\/+$/, '');
  if (!normalized) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return;
  const { error } = await supabase
    .from('agent_inbound_notifications')
    .delete()
    .eq('owner_user_id', session.user.id)
    .eq('sender_agent_rpc_url', normalized);
  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'post-fix-requests-direct',hypothesisId:'H15-confirmed',location:'lib/agentInbound.ts:dismissAgentInboundBySenderRpcUrl',message:'dismissed inbound row after owner direct reply',data:{normalized,hadError:Boolean(error),error:error?.message??null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}
