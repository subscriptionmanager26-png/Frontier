import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import {
  listNotificationLog,
  markNotificationDetailViewed,
  type NotificationLogRow,
} from '@/lib/notificationLog';
import { fetchTaskForNotificationDetail } from '@/lib/subscriptionPushBridge';

type ResolvedNotificationTask = NonNullable<Awaited<ReturnType<typeof fetchTaskForNotificationDetail>>>;

function parseNotificationData(dataJson: string): Record<string, unknown> {
  try {
    const o = JSON.parse(dataJson);
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function embeddedDataMessage(data: Record<string, unknown>): string | null {
  for (const k of ['output', 'message', 'text', 'agentOutput']) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export default function NotificationsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<NotificationLogRow[]>([]);
  const [detail, setDetail] = useState<NotificationLogRow | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown>>({});
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [resolvedTask, setResolvedTask] = useState<ResolvedNotificationTask | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listNotificationLog(200));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const openDetail = useCallback(
    async (item: NotificationLogRow) => {
      void markNotificationDetailViewed(item.notificationIdentifier).catch(() => {});
      void refresh();
      const data = parseNotificationData(item.dataJson);
      setDetail(item);
      setDetailData(data);
      setTaskError(null);
      setResolvedTask(null);

      const embedded = embeddedDataMessage(data);
      const hasTaskId = typeof data.taskId === 'string' && data.taskId.length > 0;

      if (hasTaskId) {
        setTaskLoading(true);
        try {
          const r = await fetchTaskForNotificationDetail(data);
          setResolvedTask(r);
          if (r) {
            setTaskError(null);
          } else {
            setTaskError(
              embedded
                ? 'Could not load task from agent (showing payload text below if present).'
                : 'Could not load task from agent. Ensure the push includes baseUrl or agentUrl, or the task matches a stored subscription.'
            );
          }
        } catch (e) {
          setTaskError(e instanceof Error ? e.message : 'Failed to load task.');
        } finally {
          setTaskLoading(false);
        }
      } else if (!embedded) {
        setTaskError(null);
      }
    },
    [refresh]
  );

  const closeDetail = useCallback(() => {
    setDetail(null);
    setDetailData({});
    setTaskLoading(false);
    setTaskError(null);
    setResolvedTask(null);
  }, []);

  const embedded = embeddedDataMessage(detailData);
  const showTaskSection = typeof detailData.taskId === 'string' && detailData.taskId.length > 0;

  return (
    <>
      <FlatList
        style={{ backgroundColor: shell.canvas }}
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(i) => i.notificationIdentifier}
        onRefresh={refresh}
        refreshing={false}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.mutedText }]}>No notifications logged yet.</Text>}
        renderItem={({ item }) => {
          const isSilent = !item.title && !item.body;
          return (
            <Pressable
              onPress={() => void openDetail(item)}
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
              <View style={[styles.card, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
                <Text style={[styles.chevronHint, { color: colors.tint }]}>Tap for details</Text>
                <Text style={[styles.title, { color: colors.text }]}>{item.title || 'Untitled notification'}</Text>
                <Text style={{ color: colors.mutedText, fontSize: 12 }}>{isSilent ? 'Silent' : 'User visible'}</Text>
                {item.body ? (
                  <Text style={[styles.body, { color: colors.text }]} numberOfLines={4}>
                    {item.body}
                  </Text>
                ) : null}
                <Text style={[styles.sub, { color: colors.mutedText }]}>
                  Received: {new Date(item.receivedAt).toLocaleString()}
                </Text>
                <Text style={[styles.sub, { color: colors.mutedText }]}>
                  Opened: {item.openedAt ? new Date(item.openedAt).toLocaleString() : 'Not opened'}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={detail !== null} animationType="slide" transparent onRequestClose={closeDetail}>
        <View style={[styles.modalBackdrop, { paddingTop: insets.top, backgroundColor: shell.scrim }]}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={2}>
                {detail?.title || 'Notification'}
              </Text>
              <Pressable onPress={closeDetail} hitSlop={12}>
                <Text style={{ color: colors.tint, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={[styles.modalScrollContent, { paddingBottom: 24 + insets.bottom }]}>
              {detail?.body ? (
                <Text style={[styles.sectionBody, { color: colors.text }]}>{detail.body}</Text>
              ) : (
                <Text style={{ color: colors.mutedText, marginBottom: 12 }}>No notification body.</Text>
              )}

              {embedded ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>From payload</Text>
                  <Text style={[styles.sectionBody, { color: colors.text }]} selectable>
                    {embedded}
                  </Text>
                </View>
              ) : null}

              {showTaskSection ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>Agent task</Text>
                  <Text style={[styles.monoSmall, { color: colors.mutedText }]} selectable>
                    taskId: {String(detailData.taskId)}
                  </Text>
                  {taskLoading ? (
                    <ActivityIndicator color={colors.tint} style={{ marginTop: 12 }} />
                  ) : null}
                  {taskError ? (
                    <Text style={[styles.warn, { color: colors.mutedText }]}>{taskError}</Text>
                  ) : null}
                  {resolvedTask ? (
                    <>
                      <Text style={[styles.statusLine, { color: colors.text }]}>
                        Status: {resolvedTask.latest.status}
                      </Text>
                      {resolvedTask.latest.subscription?.isSubscription ? (
                        <Text style={[styles.monoSmall, { color: colors.mutedText }]}>
                          Subscription run #{resolvedTask.latest.subscription.runCount ?? '—'}
                        </Text>
                      ) : null}
                      {resolvedTask.latest.status === 'completed' && resolvedTask.latest.output ? (
                        <Text style={[styles.taskOutput, { color: colors.text }]} selectable>
                          {resolvedTask.latest.output}
                        </Text>
                      ) : null}
                      {resolvedTask.latest.status === 'failed' || resolvedTask.latest.error ? (
                        <Text style={[styles.taskOutput, { color: '#c00' }]} selectable>
                          {resolvedTask.latest.error || 'Task failed.'}
                        </Text>
                      ) : null}
                      {(resolvedTask.latest.status === 'input_required' ||
                        resolvedTask.latest.status === 'auth_required') &&
                      resolvedTask.latest.output ? (
                        <Text style={[styles.taskOutput, { color: colors.text }]} selectable>
                          {resolvedTask.latest.output}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>Raw data</Text>
                <Text style={[styles.mono, { color: colors.text }]} selectable>
                  {JSON.stringify(detailData, null, 2)}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 16, padding: 16 },
  chevronHint: { fontSize: 11, fontWeight: '600', marginBottom: 8, letterSpacing: 0.3 },
  title: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  body: { marginTop: 6, fontSize: 13, lineHeight: 18 },
  sub: { marginTop: 4, fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  modalTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  modalScroll: { maxHeight: 520 },
  modalScrollContent: { paddingHorizontal: 16 },
  section: { marginTop: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  sectionBody: { fontSize: 15, lineHeight: 22 },
  statusLine: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  taskOutput: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  warn: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  mono: { fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
  monoSmall: { fontSize: 11, lineHeight: 15, fontFamily: 'monospace', marginTop: 4 },
});
