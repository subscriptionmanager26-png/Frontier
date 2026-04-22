import { useNavigation } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { McpStreamableClient } from '@/lib/mcpStreamableClient';
import { buildAuthHeaders } from '@/lib/testConnection';
import { getSecret, getServer } from '@/lib/serverStorage';
import type { McpToolMeta } from '@/types/mcp';

export default function ServerToolsScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [loading, setLoading] = useState(true);
  const [tools, setTools] = useState<McpToolMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<McpToolMeta | null>(null);
  const [argsText, setArgsText] = useState('{}');
  const [calling, setCalling] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);

  const loadTools = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setTools([]);
    setResultText(null);
    const server = await getServer(id);
    const secret = await getSecret(id);
    if (!server) {
      setError('Server not found.');
      setLoading(false);
      return;
    }
    if (!secret?.length) {
      setError('No credentials. Sign in or add a token first.');
      setLoading(false);
      return;
    }

    const headers = buildAuthHeaders(server.authHeaderName, secret);
    const client = new McpStreamableClient(server.baseUrl, headers);
    try {
      await client.connect();
      const list = await client.listTools();
      setTools(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      await client.close().catch(() => {});
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selected ? selected.name : 'Tools',
      headerRight: selected
        ? () => (
            <Pressable onPress={() => setSelected(null)} style={{ marginRight: 16 }}>
              <Text style={{ color: colors.tint, fontSize: 16 }}>List</Text>
            </Pressable>
          )
        : () => null,
    });
  }, [navigation, selected, colors.tint]);

  const onRunTool = async () => {
    if (!id || !selected) return;
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(argsText.trim() || '{}') as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Arguments must be a JSON object, e.g. {} or {"key":"value"}');
      }
      args = parsed as Record<string, unknown>;
    } catch (e) {
      Alert.alert('Invalid JSON', e instanceof Error ? e.message : String(e));
      return;
    }

    const server = await getServer(id);
    const secret = await getSecret(id);
    if (!server || !secret?.length) {
      Alert.alert('Error', 'Missing server or credentials.');
      return;
    }

    setCalling(true);
    setResultText(null);
    const headers = buildAuthHeaders(server.authHeaderName, secret);
    const client = new McpStreamableClient(server.baseUrl, headers);
    try {
      await client.connect();
      const out = await client.callTool(selected.name, args);
      setResultText(JSON.stringify(out, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Tool call failed', msg);
      setResultText(msg);
    } finally {
      await client.close().catch(() => {});
      setCalling(false);
    }
  };

  if (loading && tools.length === 0 && !error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.muted, { color: colors.text }]}>Connecting to MCP…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {error ? (
        <View style={styles.body}>
          <Text style={[styles.errorText, { color: '#c00' }]}>{error}</Text>
          <Pressable
            onPress={loadTools}
            style={[styles.retryBtn, { backgroundColor: colors.tint }]}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : selected ? (
        <View style={styles.body}>
          {selected.description ? (
            <Text style={[styles.desc, { color: colors.text }]}>{selected.description}</Text>
          ) : null}
          <Text style={[styles.label, { color: colors.text }]}>Arguments (JSON object)</Text>
          <TextInput
            value={argsText}
            onChangeText={setArgsText}
            placeholder='{}'
            placeholderTextColor={colorScheme === 'dark' ? '#888' : '#999'}
            multiline
            style={[
              styles.jsonInput,
              { color: colors.text, borderColor: colors.tabIconDefault },
            ]}
          />
          <Pressable
            onPress={onRunTool}
            disabled={calling}
            style={[styles.runBtn, { backgroundColor: colors.tint, opacity: calling ? 0.7 : 1 }]}>
            {calling ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.runBtnText}>Run tool</Text>
            )}
          </Pressable>
          {resultText ? (
            <>
              <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>Result</Text>
              <View style={[styles.resultBox, { borderColor: colors.tabIconDefault }]}>
                <Text selectable style={[styles.resultMono, { color: colors.text }]}>
                  {resultText}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={tools}
          keyExtractor={(t) => t.name}
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={loadTools}
          ListEmptyComponent={
            <Text style={[styles.muted, { color: colors.text, textAlign: 'center', marginTop: 24 }]}>
              No tools reported by this server.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setSelected(item);
                setArgsText('{}');
                setResultText(null);
              }}
              style={[styles.toolRow, { borderColor: colors.tabIconDefault }]}>
              <FontAwesome name="cog" size={18} color={colors.tint} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.toolName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.toolDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <FontAwesome name="chevron-right" size={14} color={colors.tabIconDefault} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { marginTop: 12, fontSize: 14, opacity: 0.7 },
  body: { flex: 1, padding: 16 },
  list: { padding: 16, paddingBottom: 32 },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  toolName: { fontSize: 16, fontWeight: '600' },
  toolDesc: { fontSize: 13, opacity: 0.65, marginTop: 4 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 16, opacity: 0.85 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  jsonInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: 'SpaceMono',
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  runBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  runBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  resultBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    maxHeight: 320,
  },
  resultMono: { fontSize: 12, fontFamily: 'SpaceMono' },
  errorText: { fontSize: 15, marginBottom: 16, lineHeight: 22 },
  retryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
