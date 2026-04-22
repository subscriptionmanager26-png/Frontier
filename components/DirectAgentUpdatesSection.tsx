import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  DeviceEventEmitter,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { SubscriptionUpdatePayload } from '@/components/SubscriptionUpdatePayload';
import { Text } from '@/components/Themed';
import { HeaderIconButton } from '@/components/ui/HeaderIconButton';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { getA2aRetryCount, getA2aTimeoutMs, getA2aToken } from '@/lib/appSettings';
import { a2aService } from '@/lib/a2a/service';
import { normalizeAgentBaseUrl } from '@/lib/a2a/resolveAgentUrl';
import { FRONTIER_A2A_UI_REFRESH } from '@/lib/a2aUiRefreshBus';
import {
  appendSubscriptionFeedItemFromTask,
  filterSubscriptionFeedForAgent,
  getSubscriptionArchivePendingCount,
  listSubscriptionFeedItems,
  loadSubscriptionArchiveItemsForTask,
  refreshAllActiveSubscriptionFeeds,
  removeActiveSubscription,
  type SubscriptionFeedItem,
} from '@/lib/subscriptionUpdatesFeed';

type Props = {
  agentUrl: string;
};

export function DirectAgentUpdatesSection({ agentUrl }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(scheme === 'dark' ? 'dark' : 'light');

  const [rows, setRows] = useState<SubscriptionFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveRows, setArchiveRows] = useState<SubscriptionFeedItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveCounts, setArchiveCounts] = useState<Record<string, number>>({});
  const lastRefreshAtRef = useRef(0);

  const load = useCallback(async () => {
    if (!agentUrl) return;
    const all = await listSubscriptionFeedItems();
    setRows(filterSubscriptionFeedForAgent(agentUrl, all));
  }, [agentUrl]);

  const onSync = useCallback(async () => {
    if (!agentUrl) return;
    setSyncing(true);
    try {
      await refreshAllActiveSubscriptionFeeds();
      await load();
    } catch (e) {
      Alert.alert('Sync failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [agentUrl, load]);

  useFocusEffect(
    useCallback(() => {
      if (!agentUrl) return;
      let cancelled = false;
      setLoading(true);
      void (async () => {
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [agentUrl, load])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < 4000) return;
      lastRefreshAtRef.current = now;
      void (async () => {
        await refreshAllActiveSubscriptionFeeds();
        await load();
      })();
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_UI_REFRESH, () => {
      void load();
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(rows.map((r) => r.taskId))];
    if (ids.length === 0) {
      setArchiveCounts({});
      return;
    }
    void (async () => {
      const next: Record<string, number> = {};
      await Promise.all(
        ids.map(async (tid) => {
          try {
            next[tid] = await getSubscriptionArchivePendingCount(tid);
          } catch {
            next[tid] = 0;
          }
        })
      );
      if (!cancelled) setArchiveCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onUnsubscribe = useCallback(
    async (item: SubscriptionFeedItem) => {
      if (!item.unsubscribeTaskId) return;
      const base = normalizeAgentBaseUrl(item.baseUrl) || item.baseUrl.trim().replace(/\/+$/, '');
      const [token, timeoutMs, retryCount] = await Promise.all([
        getA2aToken(),
        getA2aTimeoutMs(),
        getA2aRetryCount(),
      ]);
      Alert.alert('Unsubscribe', 'Stop this subscription task?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsubscribe',
          style: 'destructive',
          onPress: async () => {
            try {
              await a2aService.cancelTask({
                config: { baseUrl: base, token: token?.trim() || null, timeoutMs, retryCount },
                taskId: item.unsubscribeTaskId!,
              });
              await appendSubscriptionFeedItemFromTask(base, {
                taskId: item.taskId,
                sessionId: item.sessionId || item.taskId,
                status: 'cancelled',
                output: 'Subscription cancelled.',
                subscription: {
                  isSubscription: true,
                  unsubscribeTaskId: item.unsubscribeTaskId,
                  runCount: item.runCount,
                },
              });
              await removeActiveSubscription(item.unsubscribeTaskId ?? item.taskId);
              await load();
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]);
    },
    [load]
  );



  const { latestRows, archivesByKey } = useMemo(() => {
    const byKey = new Map<string, SubscriptionFeedItem[]>();
    for (const row of rows) {
      const k = row.unsubscribeTaskId || `${row.baseUrl}::${row.taskId}`;
      const list = byKey.get(k);
      if (list) list.push(row);
      else byKey.set(k, [row]);
    }
    const latest: SubscriptionFeedItem[] = [];
    for (const list of byKey.values()) {
      list.sort((a, b) => b.receivedAt - a.receivedAt);
      latest.push(list[0]);
    }
    latest.sort((a, b) => b.receivedAt - a.receivedAt);
    return { latestRows: latest, archivesByKey: byKey };
  }, [rows]);

  const appColors = {
    text: colors.text,
    tint: colors.tint,
    border: colors.border,
    card: colors.card,
    background: colors.background,
  };

  if (!agentUrl) {
    return null;
  }

  return (
    <View style={[styles.root, { backgroundColor: shell.canvas }]}>
      <View style={[styles.sectionHead, { borderBottomColor: shell.borderSubtle }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedText }]}>Updates</Text>
        <Pressable onPress={() => void onSync()} disabled={syncing} hitSlop={8} style={styles.syncBtn}>
          {syncing ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <Text style={{ color: colors.tint, fontWeight: '600', fontSize: 14 }}>Sync</Text>
          )}
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : (
        <FlatList
          data={latestRows}
          keyExtractor={(item) => item.id}
          style={styles.list}
          nestedScrollEnabled
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={colors.tint} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={null}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedText }]}>
              No subscription updates yet.
            </Text>
          }
          renderItem={({ item: u }) => {
            const body = u.error ? `**Error:** ${u.error}` : u.output || '';
            const key = u.unsubscribeTaskId || `${u.baseUrl}::${u.taskId}`;
            const archive = archivesByKey.get(key) || [];
            const archiveCount =
              archiveCounts[u.taskId] ?? Math.max(0, archive.length - 1);
            return (
              <View style={[styles.card, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
                <View style={styles.metaRow}>
                  <Text style={[styles.statusPill, { color: colors.tint, borderColor: colors.tint }]}>{u.status}</Text>
                  {typeof u.runCount === 'number' ? (
                    <Text style={[styles.metaText, { color: colors.mutedText }]}>Run #{u.runCount}</Text>
                  ) : null}
                  <Text style={[styles.metaText, { color: colors.mutedText }]}>
                    {new Date(u.receivedAt).toLocaleString()}
                  </Text>
                </View>
                <Text style={[styles.taskId, { color: colors.mutedText }]} selectable numberOfLines={1}>
                  Task {u.taskId.slice(0, 12)}…
                </Text>
                {body.trim() ? (
                  <SubscriptionUpdatePayload contentKey={u.id} body={body} colors={appColors} isDark={isDark} />
                ) : null}
                <View style={styles.actions}>
                  {archiveCount > 0 ? (
                    <Pressable
                      onPress={() => {
                        setArchiveOpen(true);
                        setArchiveLoading(true);
                        setArchiveRows([]);
                        void (async () => {
                          try {
                            const fromEm = await loadSubscriptionArchiveItemsForTask({
                              taskId: u.taskId,
                              baseUrl: u.baseUrl,
                              unsubscribeTaskId: u.unsubscribeTaskId,
                            });
                            setArchiveRows(fromEm.length > 0 ? fromEm : archive.slice(1));
                          } finally {
                            setArchiveLoading(false);
                          }
                        })();
                      }}
                      style={styles.textAction}>
                      <Text style={{ color: colors.mutedText, fontWeight: '600' }}>Archive ({archiveCount})</Text>
                    </Pressable>
                  ) : null}
                  {u.unsubscribeTaskId ? (
                    <Pressable onPress={() => void onUnsubscribe(u)} style={styles.textAction}>
                      <Text style={{ color: colors.mutedText, fontWeight: '600' }}>Unsubscribe</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal visible={archiveOpen} animationType="slide" transparent onRequestClose={() => setArchiveOpen(false)}>
        <View style={styles.archiveBackdrop}>
          <View style={[styles.archiveSheet, { backgroundColor: colors.card }]}>
            <View style={styles.archiveHeader}>
              <Text style={[styles.sectionTitle, { color: colors.mutedText }]}>Archive</Text>
              <HeaderIconButton
                onPress={() => setArchiveOpen(false)}
                color={colors.tint}
                icon="times"
                accessibilityLabel="Close archive"
              />
            </View>
            {archiveLoading && archiveRows.length === 0 ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color={colors.tint} />
              </View>
            ) : null}
            <FlatList
              data={archiveRows}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                !archiveLoading ? (
                  <Text style={[styles.empty, { color: colors.mutedText }]}>No archive entries.</Text>
                ) : null
              }
              renderItem={({ item }) => {
                const body = item.error ? `**Error:** ${item.error}` : item.output || '';
                return (
                  <View style={[styles.card, { backgroundColor: colors.background }]}>
                    <View style={styles.metaRow}>
                      <Text style={[styles.statusPill, { color: colors.tint, borderColor: colors.tint }]}>{item.status}</Text>
                      {typeof item.runCount === 'number' ? (
                        <Text style={[styles.metaText, { color: colors.mutedText }]}>Run #{item.runCount}</Text>
                      ) : null}
                      <Text style={[styles.metaText, { color: colors.mutedText }]}>{new Date(item.receivedAt).toLocaleString()}</Text>
                    </View>
                    {body.trim() ? (
                      <SubscriptionUpdatePayload contentKey={item.id} body={body} colors={appColors} isDark={isDark} />
                    ) : null}
                  </View>
                );
              }}
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  syncBtn: { minWidth: 56, alignItems: 'flex-end', paddingVertical: 4 },
  loadingBox: { paddingVertical: 24, alignItems: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  empty: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 16, paddingHorizontal: 8 },
  card: { borderRadius: 14, padding: 14, marginBottom: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusPill: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metaText: { fontSize: 11 },
  taskId: { fontSize: 11, marginBottom: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  textAction: { paddingVertical: 6 },
  archiveBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  archiveSheet: { maxHeight: "70%", borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 10 },
  archiveHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
});

