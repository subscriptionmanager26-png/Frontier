import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, DeviceEventEmitter, FlatList, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow, shellSectionLabel } from '@/constants/appShell';
import { a2aService } from '@/lib/a2a/service';
import { getAgentNameFromCard } from '@/lib/a2a/agentCard';
import {
  getA2aBaseUrl,
  getA2aRetryCount,
  getA2aTimeoutMs,
  getA2aToken,
} from '@/lib/appSettings';
import { listA2aTaskSnapshots, type A2aTaskSnapshot } from '@/lib/a2a/store';
import { FRONTIER_A2A_UI_REFRESH } from '@/lib/a2aUiRefreshBus';

function mapBucket(status: string): 'Active' | 'Interrupted' | 'Completed' {
  const s = status.toUpperCase();
  if (s.includes('INPUT_REQUIRED') || s.includes('AUTH_REQUIRED')) return 'Interrupted';
  if (
    s.includes('COMPLETED') ||
    s.includes('FAILED') ||
    s.includes('CANCELLED') ||
    s.includes('CANCELED') ||
    s.includes('REJECTED')
  )
    return 'Completed';
  return 'Active';
}

function isCancellable(status: string): boolean {
  const b = mapBucket(status);
  return b === 'Active' || b === 'Interrupted';
}

export default function TasksScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const [items, setItems] = useState<A2aTaskSnapshot[]>([]);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [selectedTask, setSelectedTask] = useState<A2aTaskSnapshot | null>(null);

  const summaryText = useCallback((t: A2aTaskSnapshot): string => {
    const m = (t.userMessage || '').trim();
    if (m) return m;
    return `Task ${t.taskId.slice(0, 8)}...`;
  }, []);

  const refresh = useCallback(async () => {
    const rows = await listA2aTaskSnapshots();
    setItems(rows);
    const token = await getA2aToken();
    const urls = Array.from(new Set(rows.map((x) => x.agentUrl).filter((x): x is string => !!x)));
    const pairs = await Promise.all(
      urls.map(async (u) => [u, await getAgentNameFromCard(u, token)] as const)
    );
    setAgentNames(Object.fromEntries(pairs));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_UI_REFRESH, () => {
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const cancelTask = useCallback(
    async (task: A2aTaskSnapshot) => {
      if (cancellingTaskId === task.taskId) return;
      setCancellingTaskId(task.taskId);
      try {
        const [baseUrl, token, timeoutMs, retryCount] = await Promise.all([
          getA2aBaseUrl(),
          getA2aToken(),
          getA2aTimeoutMs(),
          getA2aRetryCount(),
        ]);
        const effectiveBaseUrl = (task.agentUrl || baseUrl).trim();
        if (!effectiveBaseUrl) return;
        await a2aService.cancelTask({
          config: {
            baseUrl: effectiveBaseUrl,
            token: token?.trim() || null,
            timeoutMs,
            retryCount,
          },
          taskId: task.taskId,
          contextId: task.sessionId ?? undefined,
        });
        setItems((prev) =>
          prev.map((x) => (x.taskId === task.taskId ? { ...x, status: 'CANCELLED' } : x))
        );
        await refresh();
        Alert.alert('Task updated', 'Cancel request sent successfully.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Prevent uncaught promise noise from bubbling in RN.
        Alert.alert('Unable to cancel task', msg || 'Unknown error');
      } finally {
        setCancellingTaskId(null);
      }
    },
    [cancellingTaskId, refresh]
  );

  const onTaskPress = useCallback(
    (task: A2aTaskSnapshot) => {
      setSelectedTask(task);
    },
    []
  );

  const grouped = useMemo(() => {
    const active: A2aTaskSnapshot[] = [];
    const interrupted: A2aTaskSnapshot[] = [];
    const completed: A2aTaskSnapshot[] = [];
    for (const it of items) {
      const b = mapBucket(it.status);
      if (b === 'Active') active.push(it);
      else if (b === 'Interrupted') interrupted.push(it);
      else completed.push(it);
    }
    return { active, interrupted, completed };
  }, [items]);

  const openInChat = useCallback(
    (task: A2aTaskSnapshot) => {
      const tid = task.threadId || '';
      if (tid.startsWith('frontier-ui-user-')) {
        const userAgentId = tid.slice('frontier-ui-user-'.length);
        if (userAgentId) {
          router.push(`/agent/${userAgentId}`);
          return;
        }
      }
      if (task.agentUrl?.trim()) {
        router.push({ pathname: '/direct/agent', params: { url: task.agentUrl.trim() } });
        return;
      }
      router.push('/direct');
    },
    [router]
  );

  const sections: Array<{ title: string; data: A2aTaskSnapshot[] }> = [
    { title: 'Active (SUBMITTED, WORKING)', data: grouped.active },
    { title: 'Interrupted (INPUT_REQUIRED, AUTH_REQUIRED)', data: grouped.interrupted },
    { title: 'Completed (COMPLETED, FAILED, CANCELLED, CANCELED, REJECTED)', data: grouped.completed },
  ];

  return (
    <>
      <FlatList
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.content}
      data={sections}
      keyExtractor={(s) => s.title}
      onRefresh={refresh}
      refreshing={false}
      renderItem={({ item: section }) => (
        <View style={[styles.card, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
          <Text style={[shellSectionLabel(colors.mutedText), { marginBottom: 10 }]}>{section.title}</Text>
          {section.data.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedText }]}>No tasks</Text>
          ) : (
            section.data.map((t) => (
              <Pressable
                key={t.taskId}
                onPress={() => onTaskPress(t)}
                style={[styles.row, { borderTopColor: colors.border }]}>
                <Text style={[styles.message, { color: colors.text }]} numberOfLines={2}>
                  {summaryText(t)}
                </Text>
                <Text style={{ color: colors.text }}>{t.status}</Text>
                <Text numberOfLines={1} style={[styles.sub, { color: colors.mutedText }]}>
                  {t.agentUrl ? agentNames[t.agentUrl] || 'Unknown Agent' : 'Unknown Agent'}
                </Text>
                <Text style={[styles.sub, { color: colors.tint }]}>
                  Open details
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}
      />
      <Modal
        visible={!!selectedTask}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedTask(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {selectedTask ? (
              <>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Task details</Text>
                  <Pressable onPress={() => setSelectedTask(null)} hitSlop={8}>
                    <Text style={{ color: colors.tint, fontWeight: '700' }}>Close</Text>
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={styles.modalBody}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedText }]}>Message</Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>
                    {(selectedTask.userMessage || '').trim() || '—'}
                  </Text>

                  <Text style={[styles.fieldLabel, { color: colors.mutedText }]}>Task ID</Text>
                  <Text style={[styles.fieldMono, { color: colors.text }]} selectable>
                    {selectedTask.taskId}
                  </Text>

                  <Text style={[styles.fieldLabel, { color: colors.mutedText }]}>Status</Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>{selectedTask.status}</Text>

                  <Text style={[styles.fieldLabel, { color: colors.mutedText }]}>Triggered at</Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>
                    {new Date(selectedTask.submittedAt || selectedTask.updatedAt).toLocaleString()}
                  </Text>

                  <Text style={[styles.fieldLabel, { color: colors.mutedText }]}>Agent</Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>
                    {selectedTask.agentUrl
                      ? agentNames[selectedTask.agentUrl] || 'Unknown Agent'
                      : 'Unknown Agent'}
                  </Text>

                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => {
                        setSelectedTask(null);
                        openInChat(selectedTask);
                      }}
                      style={[styles.actionBtn, { borderColor: colors.tint }]}>
                      <Text style={{ color: colors.tint, fontWeight: '700' }}>Open in chat</Text>
                    </Pressable>
                    {isCancellable(selectedTask.status) ? (
                      <Pressable
                        onPress={() => {
                          void cancelTask(selectedTask);
                        }}
                        style={[styles.actionBtn, { borderColor: colors.border }]}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>
                          {cancellingTaskId === selectedTask.taskId ? 'Cancelling...' : 'Cancel task'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  card: { borderRadius: 16, padding: 18 },
  empty: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  row: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  message: { fontSize: 13, fontWeight: '600' },
  sub: { marginTop: 2, fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalBody: { paddingHorizontal: 16, paddingBottom: 22 },
  fieldLabel: { marginTop: 12, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  fieldValue: { marginTop: 4, fontSize: 14, lineHeight: 20 },
  fieldMono: { marginTop: 4, fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  actionBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
});
