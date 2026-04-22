import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  type AgentInboundRow,
  fetchAgentInboundForOwner,
  markAgentInboundRead,
  subscribeAgentInboundChanges,
} from '@/lib/agentInbound';
import type { AgentUiMessage } from '@/hooks/useAgent';
import { fetchDirectMessageEvents } from '@/lib/directMessageEvents';
import { directMessageThreadId, legacyDirectMessageThreadId } from '@/lib/directMessageThreadId';
import { loadMessagesFromStorage, saveMessagesToStorage } from '@/lib/agentMessagesStorage';
import { FRONTIER_A2A_UI_REFRESH, requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { canonicalA2aAgentUrl } from '@/lib/a2a/canonicalAgentUrl';
import { shortUserId } from '@/lib/uxFlowLog';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

async function seedInboundPreviewThread(item: AgentInboundRow): Promise<void> {
  const rpc = item.sender_agent_rpc_url?.trim();
  if (!rpc || !supabase) return;
  const rpcCanon = canonicalA2aAgentUrl(rpc) || rpc;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = session?.user?.id ?? null;
  const threadId = directMessageThreadId(uid, rpcCanon);
  const legacyThreadId = legacyDirectMessageThreadId(uid, rpc);
  const fromServer = await fetchDirectMessageEvents(threadId);
  if (fromServer.length > 0) {
    await saveMessagesToStorage(threadId, fromServer as AgentUiMessage[]);
    requestA2aUiRefresh();
    return;
  }

  let existing = (await loadMessagesFromStorage(threadId)) ?? [];
  if (existing.length === 0 && legacyThreadId !== threadId) {
    const legacyLoaded = (await loadMessagesFromStorage(legacyThreadId)) ?? [];
    if (legacyLoaded.length > 0) {
      existing = legacyLoaded;
      await saveMessagesToStorage(threadId, legacyLoaded);
    }
  }

  const preview = item.last_preview?.trim() || '(empty message)';
  const taskId = item.last_task_id?.trim() ?? '';
  /**
   * One inbox row per authenticated sender; seed follows the peer so multiple legacy rows do not duplicate previews.
   */
  const seedKeyId = item.sender_user_id?.trim()
    ? `inbound-peer-${item.sender_user_id.trim()}`
    : `inbound-${item.id}`;
  const idx = existing.findIndex((m) => m.id === seedKeyId);
  if (idx >= 0) {
    const cur = existing[idx]!;
    if (cur.text === preview && cur.taskId === (taskId || undefined)) return;
    const next = [...existing];
    next[idx] = { ...cur, text: preview, taskId: taskId || undefined };
    await saveMessagesToStorage(threadId, next);
    return;
  }

  const seedMsg: AgentUiMessage = {
    id: seedKeyId,
    role: 'assistant',
    text: preview,
    taskId: taskId || undefined,
    replyToId: undefined,
  };
  await saveMessagesToStorage(threadId, [...existing, seedMsg]);
  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'conv-key-v1',hypothesisId:'H-thread',location:'app/(tabs)/direct/dm-requests.tsx:seedInboundPreviewThread',message:'seeded inbound row',data:{threadId,seedKeyId,taskId:taskId||null,rowCount:existing.length+1},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

export default function DmRequestsScreen() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [rows, setRows] = useState<AgentInboundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setError(null);
    try {
      const data = await fetchAgentInboundForOwner();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load requests.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      loadInFlightRef.current = false;
    }
  }, []);

  /** Refetch when auth user changes; clear rows only on real account switch (not first mount). */
  useEffect(() => {
    if (authLoading) return;
    const prev = lastUserIdRef.current;
    if (prev === userId) return;
    lastUserIdRef.current = userId;
    // #region agent log
    fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'sync-v1',hypothesisId:'H-A',location:'app/(tabs)/direct/dm-requests.tsx:userIdEffect',message:'inbound screen user scope changed',data:{prevShort:shortUserId(prev),nextShort:shortUserId(userId)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    if (prev !== null) {
      setRows([]);
    }
    setLoading(true);
    void load();
  }, [authLoading, userId, load]);

  /** Same refresh bus as cache clear / local writes — Requests previously ignored it (H-B). */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_UI_REFRESH, () => {
      if (authLoading || !userId) return;
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'sync-v1',hypothesisId:'H-B',location:'app/(tabs)/direct/dm-requests.tsx:uiRefreshBus',message:'inbound reload from FRONTIER_A2A_UI_REFRESH',data:{userShort:shortUserId(userId)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      void load();
    });
    return () => sub.remove();
  }, [authLoading, userId, load]);

  /** Foreground refetch: covers single-device login after the other account sent DMs (H-D). */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || authLoading || !userId) return;
      void load();
    });
    return () => sub.remove();
  }, [authLoading, userId, load]);

  /** Server-push updates for new previews / unread (H-D); apply migration so table is in supabase_realtime. */
  useEffect(() => {
    if (authLoading || !userId) return;
    return subscribeAgentInboundChanges(
      userId,
      () => {
        void load();
      },
      'dm-requests'
    );
  }, [authLoading, userId, load]);

  useFocusEffect(
    useCallback(() => {
      if (authLoading || !userId) return;
      void load();
    }, [authLoading, userId, load])
  );

  const onOpen = useCallback(
    async (item: AgentInboundRow) => {
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix-3',hypothesisId:'H11-H13',location:'app/(tabs)/direct/dm-requests.tsx:onOpen',message:'opening inbound request row',data:{hasSenderRpc:Boolean(item.sender_agent_rpc_url?.trim()),agentSlug:item.agent_slug,conversationKey:item.conversation_key,previewLen:item.last_preview?.length??0},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await markAgentInboundRead(item.id);
      requestA2aUiRefresh();
      const rawRpc = item.sender_agent_rpc_url?.trim();
      if (rawRpc) {
        await seedInboundPreviewThread(item);
        const canon = canonicalA2aAgentUrl(rawRpc) || rawRpc;
        router.push({
          pathname: '/direct/agent',
          params: {
            url: canon,
            displayName: item.sender_label,
          },
        });
      }
    },
    [router]
  );

  if (loading && rows.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: shell.canvas }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: shell.canvas }}>
      {error ? (
        <Text style={[styles.err, { color: colors.text }]}>{error}</Text>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.tint}
          />
        }
        contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.listPad}
        ListEmptyComponent={
          <View style={styles.center}>
            <FontAwesome name="inbox" size={48} color={colors.tabIconDefault} />
            <Text style={[styles.title, { color: colors.text }]}>No requests yet</Text>
            <Text style={[styles.body, { color: colors.mutedText }]}>
              When someone messages your discoverable agent while signed in, it appears here. Open the chat to reply.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void onOpen(item)}
            style={({ pressed }) => [
              styles.card,
              { borderColor: shell.borderSubtle, backgroundColor: colors.card, marginBottom: 12 },
              shellCardShadow(isDark),
              pressed && { opacity: 0.94 },
            ]}>
            <View style={styles.row}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {item.sender_label}
              </Text>
              {item.unread_count > 0 ? (
                <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                  <Text style={styles.badgeText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.preview, { color: colors.mutedText }]} numberOfLines={2}>
              {item.last_preview}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedText }]}>
              {formatTime(item.updated_at)} · your agent /{item.agent_slug}
            </Text>
            {!item.sender_agent_rpc_url?.trim() ? (
              <Text style={[styles.warn, { color: colors.mutedText }]}>
                Sender has no public agent URL on file — you can still read the preview above.
              </Text>
            ) : (
              <Text style={[styles.cta, { color: colors.tint }]}>Tap to open chat</Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  listPad: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '600', marginTop: 20, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  err: { padding: 16, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 17, fontWeight: '600', flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  preview: { fontSize: 15, marginTop: 8, lineHeight: 20 },
  meta: { fontSize: 12, marginTop: 8 },
  warn: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  cta: { fontSize: 14, marginTop: 8, fontWeight: '600' },
});
