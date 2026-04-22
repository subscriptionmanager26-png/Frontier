import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { useAuth } from '@/contexts/AuthContext';
import { getChatKeyboardDiagLog, setChatKeyboardDiagLog as persistChatKeyboardDiagLog } from '@/lib/appSettings';
import { nukeLocalChatDataForTesting } from '@/lib/clearSessionLocalCaches';

export default function SettingsOtherScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [chatKeyboardDiagLog, setChatKeyboardDiagLog] = useState(false);
  const [nukeBusy, setNukeBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const ckDiag = await getChatKeyboardDiagLog();
    setChatKeyboardDiagLog(ckDiag);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

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
        Diagnostics and account summary. Model and agent credentials live in their own cards.
      </Text>

      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Chat keyboard</Text>
        <Text style={[styles.help, { color: colors.text, marginBottom: 12 }]}>
          Toggle diagnostics to log composer padding and keyboard metrics in Metro / Xcode / adb logcat
          ([ChatKeyboard]).
        </Text>
        <View style={styles.row}>
          <Text style={{ color: colors.text, flex: 1 }}>Log keyboard diagnostics</Text>
          <Switch
            value={chatKeyboardDiagLog}
            onValueChange={async (on) => {
              setChatKeyboardDiagLog(on);
              await persistChatKeyboardDiagLog(on);
            }}
          />
        </View>
      </View>

      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
          { marginTop: 16 },
        ]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Account</Text>
        <Text style={[styles.help, { color: colors.text, marginBottom: 0 }]}>
          Signed in as: {session?.user?.email || 'Unknown user'}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
          { marginTop: 16 },
        ]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Local conversations</Text>
        <Text style={[styles.help, { color: colors.text, marginBottom: 12 }]}>
          Clears all threads stored on this device (Direct, Requests, and related A2A session data). Your account and
          agent profiles stay; messages may reappear from cloud backup when you open a chat again. Use this to test
          flows from a clean slate.
        </Text>
        <Pressable
          disabled={nukeBusy}
          onPress={() => {
            Alert.alert(
              'Clear all local conversations?',
              'This removes local message history and Direct/session metadata on this device only.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      setNukeBusy(true);
                      try {
                        await nukeLocalChatDataForTesting();
                        Alert.alert('Done', 'Local conversations were cleared.');
                      } catch (e) {
                        Alert.alert('Error', e instanceof Error ? e.message : 'Could not clear data.');
                      } finally {
                        setNukeBusy(false);
                      }
                    })();
                  },
                },
              ]
            );
          }}
          style={({ pressed }) => [
            styles.nukeButton,
            { borderColor: colors.text, opacity: nukeBusy ? 0.5 : pressed ? 0.75 : 1 },
          ]}>
          {nukeBusy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={[styles.nukeButtonLabel, { color: colors.text }]}>Clear all local conversations</Text>
          )}
        </Pressable>
      </View>

      <Text style={[styles.footer, { color: colors.text }]}>
        Frontier — chat uses Azure OpenAI when configured, otherwise OpenAI. Optional tools use your active (starred)
        MCP server.
      </Text>
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
    marginBottom: 8,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nukeButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  nukeButtonLabel: { fontSize: 16, fontWeight: '600' },
  footer: { marginTop: 28, fontSize: 13, opacity: 0.55, lineHeight: 18 },
});
