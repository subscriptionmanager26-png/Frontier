import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { listRecentA2aLogs, type A2aLogRow } from '@/lib/a2a/store';
import { clearNotificationLog, listNotificationLog, type NotificationLogRow } from '@/lib/notificationLog';

export default function SettingsLogsScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [loading, setLoading] = useState(true);
  const [notificationLog, setNotificationLog] = useState<NotificationLogRow[]>([]);
  const [subscriptionSyncLog, setSubscriptionSyncLog] = useState<A2aLogRow[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    const logs = await listNotificationLog(100);
    const syncLogs = await listRecentA2aLogs(300);
    setNotificationLog(logs);
    setSubscriptionSyncLog(
      syncLogs.filter((x) => x.hop.startsWith('subsync.') || x.hop.startsWith('autosync.'))
    );
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const onClearNotificationLog = async () => {
    await clearNotificationLog();
    setNotificationLog([]);
    Alert.alert('Cleared', 'Notification log has been cleared.');
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: shell.canvas }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.help, { color: colors.text }]}>
        Notification deliveries and subscription sync traces. Pull to refresh is not enabled; reopen this screen to
        reload.
      </Text>

      <View style={styles.logHeaderRow}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification log</Text>
        {notificationLog.length > 0 ? (
          <Pressable onPress={onClearNotificationLog}>
            <Text style={{ color: colors.tint, fontWeight: '600' }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {notificationLog.length === 0 ? (
        <Text style={[styles.muted, { color: colors.text }]}>No notifications logged yet.</Text>
      ) : (
        notificationLog.map((item) => (
          <View
            key={item.notificationIdentifier}
            style={[
              styles.logCard,
              { borderColor: colors.tabIconDefault, backgroundColor: colors.card },
              shellCardShadow(isDark),
            ]}>
            <Text style={[styles.logTitle, { color: colors.text }]}>
              {item.title || 'Untitled notification'}
            </Text>
            {item.body ? <Text style={[styles.logBody, { color: colors.text }]}>{item.body}</Text> : null}
            <Text style={[styles.logMeta, { color: colors.text }]}>
              Received: {new Date(item.receivedAt).toLocaleString()}
            </Text>
            <Text style={[styles.logMeta, { color: colors.text }]}>
              Opened: {item.openedAt ? new Date(item.openedAt).toLocaleString() : 'Not opened'}
            </Text>
            <Text style={[styles.logMeta, { color: colors.text }]} numberOfLines={1}>
              Id: {item.notificationIdentifier}
            </Text>
            <Text style={[styles.logDataLabel, { color: colors.text }]}>Payload</Text>
            <Text style={[styles.logData, { color: colors.text }]} selectable>
              {item.dataJson}
            </Text>
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24, marginBottom: 6 }]}>
        Subscription sync debug
      </Text>
      {subscriptionSyncLog.length === 0 ? (
        <Text style={[styles.muted, { color: colors.text }]}>No sync logs yet.</Text>
      ) : (
        subscriptionSyncLog.slice(0, 80).map((item, idx) => (
          <View
            key={`${item.createdAt}-${item.hop}-${idx}`}
            style={[
              styles.logCard,
              { borderColor: colors.tabIconDefault, backgroundColor: colors.card },
              shellCardShadow(isDark),
            ]}>
            <Text style={[styles.logTitle, { color: colors.text }]}>
              {item.level.toUpperCase()} · {item.hop}
            </Text>
            <Text style={[styles.logMeta, { color: colors.text }]}>
              At: {new Date(item.createdAt).toLocaleString()}
            </Text>
            {item.taskId ? <Text style={[styles.logMeta, { color: colors.text }]}>Task: {item.taskId}</Text> : null}
            {item.status ? <Text style={[styles.logMeta, { color: colors.text }]}>Status: {item.status}</Text> : null}
            {item.detailJson ? (
              <>
                <Text style={[styles.logDataLabel, { color: colors.text }]}>Detail</Text>
                <Text style={[styles.logData, { color: colors.text }]} selectable>
                  {item.detailJson}
                </Text>
              </>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 22, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  help: { fontSize: 14, opacity: 0.75, lineHeight: 20, marginBottom: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  logHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  muted: { fontSize: 14, opacity: 0.65, marginBottom: 8 },
  logCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  logTitle: { fontSize: 14, fontWeight: '700' },
  logBody: { marginTop: 6, fontSize: 13, lineHeight: 18, opacity: 0.9 },
  logMeta: { marginTop: 4, fontSize: 12, opacity: 0.7 },
  logDataLabel: { marginTop: 8, fontSize: 12, fontWeight: '700', opacity: 0.85 },
  logData: { marginTop: 4, fontSize: 11, lineHeight: 15, opacity: 0.75 },
});
