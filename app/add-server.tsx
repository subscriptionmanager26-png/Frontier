import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell } from '@/constants/appShell';
import { runMcpOAuthSignIn } from '@/lib/mcpOAuth';
import { getSecret, getServer, saveServer, type SecretUpdate } from '@/lib/serverStorage';
import { SWIGGY_MCP_MANIFEST, isSwiggyMcpUrl } from '@/lib/swiggyMcp';
import type { McpServer, McpTransport } from '@/types/mcp';

export default function AddServerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [loading, setLoading] = useState(!!id);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [transport, setTransport] = useState<McpTransport>('http');
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [manualToken, setManualToken] = useState(false);
  const [token, setToken] = useState('');
  const [removeCredentials, setRemoveCredentials] = useState(false);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    const s = await getServer(id);
    if (!s) {
      Alert.alert('Not found', 'This server was removed.');
      router.back();
      return;
    }
    setName(s.name);
    setBaseUrl(s.baseUrl);
    setTransport(s.transport);
    setAuthHeaderName(s.authHeaderName);
    const sec = await getSecret(id);
    setHasStoredSecret(!!sec?.length);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = async () => {
    const n = name.trim();
    const u = baseUrl.trim();
    if (!n) {
      Alert.alert('Name required', 'Give this connection a short name.');
      return;
    }
    if (!u) {
      Alert.alert('URL required', 'Enter the MCP endpoint URL.');
      return;
    }
    let secretUpdate: SecretUpdate = { mode: 'unchanged' };
    if (!id) {
      secretUpdate =
        manualToken && token.trim().length > 0
          ? { mode: 'set', value: token.trim() }
          : { mode: 'clear' };
    } else {
      if (removeCredentials) {
        secretUpdate = { mode: 'clear' };
      } else if (token.trim().length > 0) {
        secretUpdate = { mode: 'set', value: token.trim() };
      } else {
        secretUpdate = { mode: 'unchanged' };
      }
    }

    setSaving(true);
    try {
      await saveServer(
        {
          id,
          name: n,
          baseUrl: u,
          transport,
          authHeaderName: authHeaderName.trim() || 'Authorization',
        },
        secretUpdate
      );
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Could not save', msg);
    } finally {
      setSaving(false);
    }
  };

  const onBrowserSignIn = async () => {
    const n = name.trim();
    const u = baseUrl.trim();
    if (!n || !u) {
      Alert.alert('Required', 'Enter a display name and URL first.');
      return;
    }
    if (Platform.OS === 'web') {
      Alert.alert(
        'Not available on web',
        'Open this app in Expo Go on iOS or Android to sign in with the provider.'
      );
      return;
    }
    setOauthBusy(true);
    try {
      let s: McpServer;
      if (id) {
        await saveServer(
          {
            id,
            name: n,
            baseUrl: u,
            transport,
            authHeaderName: authHeaderName.trim() || 'Authorization',
          },
          { mode: 'unchanged' }
        );
        const loaded = await getServer(id);
        if (!loaded) {
          Alert.alert('Error', 'Server not found.');
          return;
        }
        s = loaded;
      } else {
        s = await saveServer(
          {
            name: n,
            baseUrl: u,
            transport,
            authHeaderName: authHeaderName.trim() || 'Authorization',
          },
          { mode: 'clear' }
        );
      }
      const r = await runMcpOAuthSignIn(s);
      if (r.ok) {
        Alert.alert('Signed in', 'Access token saved securely on this device.');
        router.back();
      } else {
        Alert.alert('Sign-in failed', r.message);
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    } finally {
      setOauthBusy(false);
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
    <>
      <Stack.Screen
        options={{
          title: id ? 'Edit server' : 'Add MCP server',
          headerStyle: {
            backgroundColor: shell.elevated,
          },
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600', fontSize: 17, color: colors.text },
          headerTintColor: colors.tint,
          headerRight: () =>
            saving ? (
              <ActivityIndicator color={colors.tint} style={{ marginRight: 16 }} />
            ) : (
              <Pressable onPress={onSave} style={{ marginRight: 16 }}>
                <Text style={{ color: colors.tint, fontSize: 17, fontWeight: '600' }}>Save</Text>
              </Pressable>
            ),
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: shell.canvas }}>
        <ScrollView
          style={{ backgroundColor: shell.canvas }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Home assistant tools"
            placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
            style={[
              styles.input,
              { color: colors.text, borderColor: shell.borderSubtle, backgroundColor: colors.card },
            ]}
          />

          <Text style={styles.label}>Endpoint URL</Text>
          <TextInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://your-host/mcp"
            placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { color: colors.text, borderColor: shell.borderSubtle, backgroundColor: colors.card }]}
          />
          {isSwiggyMcpUrl(baseUrl) ? (
            <Text style={[styles.swiggyNote, { color: colors.text }]}>
              Swiggy: “Sign in with browser” opens a WebView and completes OAuth via http://127.0.0.1/callback (allowed
              by Swiggy). If that still fails, see {SWIGGY_MCP_MANIFEST} or use “Advanced: paste token”.
            </Text>
          ) : null}

          <Text style={styles.label}>Transport</Text>
          <View style={styles.transportRow}>
            {(['http', 'sse'] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTransport(t)}
                style={[
                  styles.chip,
                  transport === t && { backgroundColor: colors.tint },
                  { borderColor: shell.borderSubtle },
                ]}>
                <Text
                  style={[
                    styles.chipText,
                    transport === t ? { color: '#fff' } : { color: colors.text },
                  ]}>
                  {t === 'http' ? 'HTTP (streamable)' : 'SSE'}
                </Text>
              </Pressable>
            ))}
          </View>

          {Platform.OS !== 'web' ? (
            <>
              <Pressable
                onPress={onBrowserSignIn}
                disabled={oauthBusy || saving}
                style={[
                  styles.oauthBtn,
                  { backgroundColor: colors.tint, opacity: oauthBusy || saving ? 0.6 : 1 },
                ]}>
                {oauthBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.oauthBtnText}>Sign in with browser</Text>
                )}
              </Pressable>
              <Text style={styles.oauthHint}>
                Opens your provider’s login page. After you approve, you return here and the app
                stores the token — no copy/paste.
              </Text>
            </>
          ) : (
            <Text style={styles.oauthHint}>
              Browser sign-in requires Expo Go on a device. On web, use “Advanced” below to paste a
              token.
            </Text>
          )}

          {!id ? (
            <>
              <View style={styles.row}>
                <Text style={styles.switchLabel}>Advanced: paste token manually</Text>
                <Switch value={manualToken} onValueChange={setManualToken} />
              </View>
              {manualToken && (
                <>
                  <Text style={styles.label}>Auth header name</Text>
                  <TextInput
                    value={authHeaderName}
                    onChangeText={setAuthHeaderName}
                    placeholder="Authorization"
                    placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
                    autoCapitalize="none"
                    style={[
                      styles.input,
                      { color: colors.text, borderColor: shell.borderSubtle, backgroundColor: colors.card },
                    ]}
                  />
                  <Text style={styles.label}>Token or header value</Text>
                  <TextInput
                    value={token}
                    onChangeText={setToken}
                    placeholder="Access token or API key"
                    placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
                    secureTextEntry
                    autoCapitalize="none"
                    style={[
                      styles.input,
                      { color: colors.text, borderColor: shell.borderSubtle, backgroundColor: colors.card },
                    ]}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                {hasStoredSecret
                  ? 'Credentials are stored securely on this device.'
                  : 'No credentials stored for this server. Use Sign in with browser above.'}
              </Text>
              <Text style={styles.label}>Auth header name</Text>
              <TextInput
                value={authHeaderName}
                onChangeText={setAuthHeaderName}
                placeholder="Authorization"
                placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: colors.text, borderColor: shell.borderSubtle, backgroundColor: colors.card },
                ]}
              />
              <Text style={styles.label}>New token (optional)</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="Leave blank to keep existing"
                placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
                secureTextEntry
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: colors.text, borderColor: shell.borderSubtle, backgroundColor: colors.card },
                ]}
              />
              <View style={styles.row}>
                <Text style={styles.switchLabel}>Remove stored credentials</Text>
                <Switch value={removeCredentials} onValueChange={setRemoveCredentials} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 8, opacity: 0.85 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 18,
  },
  transportRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  switchLabel: { fontSize: 16, flex: 1, paddingRight: 12 },
  hint: { fontSize: 14, opacity: 0.7, marginBottom: 16, lineHeight: 20 },
  oauthBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  oauthBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  oauthHint: {
    fontSize: 13,
    opacity: 0.72,
    lineHeight: 19,
    marginBottom: 20,
  },
  swiggyNote: {
    fontSize: 13,
    opacity: 0.72,
    lineHeight: 19,
    marginBottom: 16,
    marginTop: -8,
  },
});
