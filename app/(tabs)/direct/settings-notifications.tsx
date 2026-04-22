import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import {
  getBackgroundFetchEnabled,
  getBackgroundNotificationText,
  getNotificationsEnabled,
  setBackgroundFetchEnabled,
  setBackgroundNotificationText,
  setNotificationsEnabled,
} from '@/lib/appSettings';
import {
  registerBackgroundFetch,
  unregisterBackgroundFetch,
} from '@/lib/backgroundTasks';
import { ensureNotificationPermissions, scheduleTestNotification } from '@/lib/notifications';

export default function SettingsNotificationsScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [notifyOn, setNotifyOn] = useState(false);
  const [bgOn, setBgOn] = useState(false);
  const [bgText, setBgText] = useState('Scheduled check-in');
  const [loading, setLoading] = useState(true);
  const [testingNotify, setTestingNotify] = useState(false);
  const [copyingPushToken, setCopyingPushToken] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [n, b, t] = await Promise.all([
      getNotificationsEnabled(),
      getBackgroundFetchEnabled(),
      getBackgroundNotificationText(),
    ]);
    setNotifyOn(n);
    setBgOn(b);
    setBgText(t);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const onNotifyToggle = async (on: boolean) => {
    if (on) {
      const ok = await ensureNotificationPermissions();
      if (!ok) {
        Alert.alert('Permission needed', 'Enable notifications in system settings to use this.');
        return;
      }
    }
    setNotifyOn(on);
    await setNotificationsEnabled(on);
    if (!on && bgOn) {
      setBgOn(false);
      await setBackgroundFetchEnabled(false);
      await unregisterBackgroundFetch();
    }
  };

  const onBgToggle = async (on: boolean) => {
    if (on) {
      const ok = await ensureNotificationPermissions();
      if (!ok) {
        Alert.alert('Permission needed', 'Notifications must be allowed for background alerts.');
        return;
      }
      setNotifyOn(true);
      await setNotificationsEnabled(true);
      await registerBackgroundFetch();
    } else {
      await unregisterBackgroundFetch();
    }
    setBgOn(on);
    await setBackgroundFetchEnabled(on);
  };

  const onBgTextBlur = async () => {
    await setBackgroundNotificationText(bgText);
  };

  const testNotification = async () => {
    setTestingNotify(true);
    try {
      const id = await scheduleTestNotification();
      if (!id) {
        Alert.alert('Permission needed', 'Allow notifications to test.');
      }
    } finally {
      setTestingNotify(false);
    }
  };

  const copyPushToken = async () => {
    setCopyingPushToken(true);
    try {
      const ok = await ensureNotificationPermissions();
      if (!ok) {
        Alert.alert('Permission needed', 'Allow notifications to fetch the Expo push token.');
        return;
      }
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
      if (!projectId) {
        Alert.alert(
          'Expo projectId missing',
          'Push token needs an EAS projectId. Add `expo.extra.eas.projectId` to app.json (or link this app with EAS), then rebuild Android.'
        );
        return;
      }
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (!token) {
        Alert.alert('Unavailable', 'Could not fetch Expo push token on this device.');
        return;
      }
      await Clipboard.setStringAsync(token);
      Alert.alert('Copied', 'Expo push token copied to clipboard.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        Platform.OS === 'android' &&
        (lower.includes('firebaseapp') ||
          lower.includes('default firebaseapp is not initialized') ||
          lower.includes('fcm-credentials'))
      ) {
        Alert.alert(
          'Android push setup required',
          'FCM is not configured for this app build yet. Add firebase google-services.json at project root, then rebuild Android (expo run:android or EAS build).'
        );
      } else {
        Alert.alert('Push token error', msg);
      }
    } finally {
      setCopyingPushToken(false);
    }
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
        Local notifications and optional background fetch reminders. iOS and Android do not allow exact cron; Expo
        schedules background fetch about every 15 minutes when the OS allows.
      </Text>

      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <View style={styles.row}>
          <Text style={{ color: colors.text, flex: 1 }}>Enable local notifications</Text>
          <Switch value={notifyOn} onValueChange={onNotifyToggle} />
        </View>
        <Pressable
          onPress={testNotification}
          disabled={testingNotify}
          style={[styles.secondaryBtn, { borderColor: colors.tint }]}>
          {testingNotify ? (
            <ActivityIndicator color={colors.tint} />
          ) : (
            <Text style={{ color: colors.tint, fontWeight: '600' }}>Send test notification</Text>
          )}
        </Pressable>
        <Pressable
          onPress={copyPushToken}
          disabled={copyingPushToken}
          style={[styles.secondaryBtn, { borderColor: colors.tint }]}>
          {copyingPushToken ? (
            <ActivityIndicator color={colors.tint} />
          ) : (
            <Text style={{ color: colors.tint, fontWeight: '600' }}>Copy Expo push token</Text>
          )}
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Background fetch</Text>
      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <View style={styles.row}>
          <Text style={{ color: colors.text, flex: 1 }}>Background fetch + notify</Text>
          <Switch value={bgOn} onValueChange={onBgToggle} />
        </View>
        <Text style={[styles.label, { color: colors.text }]}>Notification body when fetch runs</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.tabIconDefault }]}
          value={bgText}
          onChangeText={setBgText}
          onBlur={onBgTextBlur}
          placeholder="Scheduled check-in"
          placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
        />
      </View>
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
    marginBottom: 10,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 12,
  },
  label: { fontSize: 14, marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  secondaryBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
});
