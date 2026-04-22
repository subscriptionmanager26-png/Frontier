import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { runMcpOAuthSignIn } from '@/lib/mcpOAuth';
import { appendSwiggyMcpHintIfNeeded } from '@/lib/swiggyMcp';
import { buildAuthHeaders, testMcpEndpoint } from '@/lib/testConnection';
import { deleteServer, getSecret, getServer } from '@/lib/serverStorage';

export default function ServerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [testing, setTesting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const [server, setServer] = useState<Awaited<ReturnType<typeof getServer>>>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [ready, setReady] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const s = await getServer(id);
    setServer(s);
    const sec = await getSecret(id);
    setHasSecret(!!sec?.length);
    setReady(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onTest = async () => {
    if (!server) return;
    setTesting(true);
    setLastResult(null);
    const secret = await getSecret(server.id);
    const headers = buildAuthHeaders(server.authHeaderName, secret);
    const { reachable, detail, status } = await testMcpEndpoint(server.baseUrl, headers);
    setTesting(false);
    setLastResult(detail);

    if (status === 401) {
      const baseHint = !secret?.length
        ? 'This endpoint requires a Bearer access token. Open Edit, add your token (header Authorization), and save.'
        : 'The server rejected the token (wrong, expired, or missing scope). Update the token under Edit.';
      let body = `${detail}\n\n${baseHint}`;
      body = appendSwiggyMcpHintIfNeeded(server.baseUrl, body);
      Alert.alert('Unauthorized (401)', body);
      return;
    }
    if (status === 403) {
      Alert.alert('Forbidden (403)', `${detail}\n\nYour token may be valid but lacks permission for this resource.`);
      return;
    }
    if (!reachable) {
      const hint = !secret?.length
        ? '\n\nNo token on this device: open Edit, set Authorization and paste the access token (raw string, no quotes).'
        : '\n\nIf the token is correct, this is usually Wi‑Fi/VPN/DNS. Try phone browser on the same network: open the MCP URL (you may see JSON or 401—that still proves reachability).';
      Alert.alert('Connection test failed', `${detail}${hint}`);
      return;
    }
    Alert.alert('Reachable', detail);
  };

  const onBrowserSignIn = async () => {
    if (!server) return;
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Use Expo Go on a phone to sign in with the provider.');
      return;
    }
    setOauthBusy(true);
    try {
      const r = await runMcpOAuthSignIn(server);
      await refresh();
      if (r.ok) {
        Alert.alert('Signed in', 'Access token saved on this device.');
      } else {
        Alert.alert('Sign-in failed', r.message);
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    } finally {
      setOauthBusy(false);
    }
  };

  const onDelete = () => {
    if (!server) return;
    Alert.alert(
      'Remove server',
      `Delete “${server.name}” from this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteServer(server.id);
            router.replace('/(tabs)');
          },
        },
      ]
    );
  };

  if (!ready || !server) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: server.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/add-server', params: { id: server.id } })}
              style={{ marginRight: 16 }}>
              <FontAwesome name="pencil" size={20} color={colors.tint} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.body}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}>
          <Row label="URL" value={server.baseUrl} />
          <Row label="Transport" value={server.transport.toUpperCase()} />
          <Row label="Auth header" value={server.authHeaderName} />
          <Row label="Credentials" value={hasSecret ? 'Stored on device' : 'None'} />
        </View>

        {Platform.OS !== 'web' ? (
          <Pressable
            onPress={onBrowserSignIn}
            disabled={oauthBusy || testing}
            style={[
              styles.secondaryBtn,
              { borderColor: colors.tint, opacity: oauthBusy || testing ? 0.6 : 1 },
            ]}>
            {oauthBusy ? (
              <ActivityIndicator color={colors.tint} />
            ) : (
              <Text style={[styles.secondaryBtnText, { color: colors.tint }]}>
                {hasSecret ? 'Refresh sign-in (browser)' : 'Sign in with browser'}
              </Text>
            )}
          </Pressable>
        ) : null}

        <Pressable
          onPress={onTest}
          disabled={testing || oauthBusy}
          style={[styles.primaryBtn, { backgroundColor: colors.tint }]}>
          {testing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Test connection</Text>
          )}
        </Pressable>

        {hasSecret ? (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/server/[id]/tools', params: { id: server.id } })
            }
            style={[styles.toolsBtn, { backgroundColor: colors.tint }]}>
            <FontAwesome name="wrench" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>List & call tools</Text>
          </Pressable>
        ) : (
          <Text style={[styles.toolsHint, { color: colors.text }]}>
            Sign in or paste a token to use MCP tools.
          </Text>
        )}

        {lastResult ? (
          <Text style={[styles.result, { color: colors.text }]}>Last check: {lastResult}</Text>
        ) : null}

        <Pressable onPress={onDelete} style={styles.dangerBtn}>
          <Text style={styles.dangerText}>Remove from device</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, paddingBottom: 40 },
  card: { borderRadius: 12, padding: 16, marginBottom: 24 },
  row: { marginBottom: 14 },
  rowLabel: { fontSize: 12, opacity: 0.6, marginBottom: 4 },
  rowValue: { fontSize: 16 },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  toolsBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  toolsHint: { fontSize: 14, opacity: 0.7, marginBottom: 16, textAlign: 'center' },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
  result: { fontSize: 14, opacity: 0.8, marginBottom: 24 },
  dangerBtn: { paddingVertical: 14, alignItems: 'center' },
  dangerText: { color: '#c00', fontSize: 16, fontWeight: '600' },
});
