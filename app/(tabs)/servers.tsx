import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { getActiveServerId, setActiveServerId } from '@/lib/activeServer';
import { listServers } from '@/lib/serverStorage';
import type { McpServer } from '@/types/mcp';

export default function ServersScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const [items, setItems] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listServers();
    setItems(list);
    setActiveId(await getActiveServerId());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const setActive = async (id: string) => {
    await setActiveServerId(id);
    setActiveId(id);
    Alert.alert('Active server', 'This server’s tools will be used in Chat when available.');
  };

  return (
    <View style={[styles.container, { backgroundColor: shell.canvas }]}>
      {loading && items.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <FontAwesome name="plug" size={48} color={colors.tabIconDefault} />
          <Text style={styles.emptyTitle}>No MCP servers yet</Text>
          <Text style={styles.emptyBody}>
            Add servers here, set one as active for the chat assistant, then use the Chat tab.
          </Text>
          <Link href="/add-server" asChild>
            <Pressable style={[styles.cta, { backgroundColor: colors.tint }]}>
              <Text style={styles.ctaText}>Add server</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          style={{ backgroundColor: shell.canvas }}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={refresh}
          ListHeaderComponent={
            <Text style={[styles.hint, { color: colors.text }]}>
              Tap ⭐ to choose which MCP server the assistant uses for tools.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
              <Pressable
                onPress={() => setActive(item.id)}
                style={styles.starBtn}
                hitSlop={12}>
                <FontAwesome
                  name={activeId === item.id ? 'star' : 'star-o'}
                  size={22}
                  color={activeId === item.id ? '#f5a623' : colors.tabIconDefault}
                />
              </Pressable>
              <Link href={{ pathname: '/server/[id]', params: { id: item.id } }} asChild style={{ flex: 1 }}>
                <Pressable style={styles.rowInner}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.baseUrl}
                    </Text>
                    <Text style={styles.badge}>{item.transport.toUpperCase()}</Text>
                  </View>
                  <FontAwesome name="chevron-right" size={14} color={colors.tabIconDefault} />
                </Pressable>
              </Link>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, fontSize: 14, lineHeight: 20, opacity: 0.78 },
  list: { padding: 20, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    marginBottom: 14,
    overflow: 'hidden',
  },
  starBtn: { paddingVertical: 16, paddingLeft: 14, paddingRight: 8 },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingRight: 14,
  },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  rowSub: { fontSize: 14, opacity: 0.65 },
  badge: { fontSize: 11, fontWeight: '700', opacity: 0.5, marginTop: 6 },
  empty: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  emptyBody: {
    fontSize: 15,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  cta: {
    marginTop: 28,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
