import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { a2aService } from '@/lib/a2a/service';
import {
  getA2aBaseUrl,
  getA2aRetryCount,
  getA2aTimeoutMs,
  getA2aToken,
  getEmbeddedA2aGatewayBaseUrl,
  setA2aRetryCount,
  setA2aTimeoutMs,
} from '@/lib/appSettings';
import { hasSupabaseConfig } from '@/lib/supabase';
import { getCurrentExpoPushToken } from '@/lib/notifications';

export default function SettingsAgentsScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [loading, setLoading] = useState(true);
  const [a2aTimeoutMsDraft, setA2aTimeoutMsDraft] = useState('15000');
  const [a2aRetryDraft, setA2aRetryDraft] = useState('1');
  const [savingA2aAdv, setSavingA2aAdv] = useState(false);
  const [connectingA2a, setConnectingA2a] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [timeout, retries] = await Promise.all([getA2aTimeoutMs(), getA2aRetryCount()]);
    setA2aTimeoutMsDraft(String(timeout));
    setA2aRetryDraft(String(retries));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const saveA2aAdvanced = async () => {
    setSavingA2aAdv(true);
    try {
      const timeout = Number(a2aTimeoutMsDraft);
      const retries = Number(a2aRetryDraft);
      await Promise.all([setA2aTimeoutMs(timeout), setA2aRetryCount(retries)]);
      await reload();
    } finally {
      setSavingA2aAdv(false);
    }
  };

  const connectA2aNow = async () => {
    setConnectingA2a(true);
    try {
      const [url, token, timeoutMs, retryCount] = await Promise.all([
        getA2aBaseUrl(),
        getA2aToken(),
        getA2aTimeoutMs(),
        getA2aRetryCount(),
      ]);
      if (!url.trim()) {
        return;
      }
      const res = await a2aService.connect({
        baseUrl: url.trim(),
        token: token?.trim() || null,
        timeoutMs,
        retryCount,
        pushChannel: 'expo',
        pushToken: await getCurrentExpoPushToken(),
      });
      if (res.ok) {
        Alert.alert(
          'Connected',
          `Protocol ${res.metadata.protocolVersion}; streaming: ${res.metadata.limits.streaming ? 'yes' : 'no'}`
        );
      } else {
        Alert.alert('Connect failed', res.error);
      }
    } finally {
      setConnectingA2a(false);
    }
  };

  const gatewayUrl = getEmbeddedA2aGatewayBaseUrl();

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
        A2A uses your app’s bundled Supabase project: gateway URL, emissions webhook, and anon key are taken from
        `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in app config — nothing to paste here.
      </Text>

      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Gateway</Text>
        {!hasSupabaseConfig ? (
          <Text style={[styles.muted, { color: colors.text }]}>
            Supabase env is missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in app config.
          </Text>
        ) : (
          <>
            <Text style={[styles.miniLabel, { color: colors.text }]}>Base URL (JSON-RPC root)</Text>
            <Text selectable style={[styles.mono, { color: colors.text }]}>
              {gatewayUrl || '—'}
            </Text>
            <Text style={[styles.miniLabel, { color: colors.text, marginTop: 12 }]}>Authorization</Text>
            <Text style={[styles.muted, { color: colors.text }]}>
              Project anon key (bundled) is sent as the Bearer token for Edge Function calls.
            </Text>
          </>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Request tuning</Text>
      <Text style={[styles.help, { color: colors.text }]}>
        Optional timeouts and retries for A2A HTTP calls.
      </Text>
      <Text style={[styles.miniLabel, { color: colors.text }]}>Timeout (ms)</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.tabIconDefault }]}
        keyboardType="numeric"
        value={a2aTimeoutMsDraft}
        onChangeText={setA2aTimeoutMsDraft}
      />
      <Text style={[styles.miniLabel, { color: colors.text }]}>Retries</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.tabIconDefault }]}
        keyboardType="numeric"
        value={a2aRetryDraft}
        onChangeText={setA2aRetryDraft}
      />
      <Pressable
        onPress={() => void saveA2aAdvanced()}
        disabled={savingA2aAdv}
        style={[styles.primaryBtn, { backgroundColor: colors.tint, opacity: savingA2aAdv ? 0.6 : 1 }]}>
        {savingA2aAdv ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Save</Text>
        )}
      </Pressable>
      <Pressable
        onPress={() => void connectA2aNow()}
        disabled={connectingA2a || !gatewayUrl}
        style={[styles.secondaryBtn, { borderColor: colors.tint, opacity: !gatewayUrl ? 0.5 : 1 }]}>
        {connectingA2a ? (
          <ActivityIndicator color={colors.tint} />
        ) : (
          <Text style={{ color: colors.tint, fontWeight: '600' }}>Test connection</Text>
        )}
      </Pressable>
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
  miniLabel: { fontSize: 12, fontWeight: '600', opacity: 0.75, marginBottom: 4 },
  muted: { fontSize: 14, opacity: 0.8, lineHeight: 20 },
  mono: { fontSize: 13, lineHeight: 18, fontFamily: 'Menlo' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  primaryBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
});
