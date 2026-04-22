import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { getActiveServerId } from '@/lib/activeServer';
import { listServers } from '@/lib/serverStorage';

export default function SettingsMcpScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [loading, setLoading] = useState(true);
  const [mcpServerCount, setMcpServerCount] = useState(0);
  const [hasActiveMcpServer, setHasActiveMcpServer] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [servers, activeServerId] = await Promise.all([listServers(), getActiveServerId()]);
    setMcpServerCount(servers.length);
    setHasActiveMcpServer(!!activeServerId);
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
        Model Context Protocol servers extend the app with tools. Configure servers here; starred server is used for
        optional tool calls.
      </Text>

      <View
        style={[
          styles.card,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <Text style={[styles.stat, { color: colors.text }]}>
          Servers configured: {mcpServerCount}
        </Text>
        <Text style={[styles.stat, { color: colors.text }]}>
          {hasActiveMcpServer ? 'Active server selected.' : 'No active server.'}
        </Text>
      </View>

      <Link href="/servers" asChild>
        <Pressable style={[styles.secondaryBtn, { borderColor: colors.tint }]}>
          <Text style={{ color: colors.tint, fontWeight: '600' }}>Manage MCP servers</Text>
        </Pressable>
      </Link>
      <Link href="/add-server" asChild>
        <Pressable style={[styles.secondaryBtn, { borderColor: colors.tint }]}>
          <Text style={{ color: colors.tint, fontWeight: '600' }}>Add MCP server</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 22, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  help: { fontSize: 14, opacity: 0.75, lineHeight: 20, marginBottom: 16 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  stat: { fontSize: 15, lineHeight: 22 },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 12,
  },
});
