import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { getA2aToken } from '@/lib/appSettings';
import { getAgentNameFromCard } from '@/lib/a2a/agentCard';
import { fetchDiscoverableDisplayNamesForRpcUrls } from '@/lib/discoverableAgentsCloudStore';
import { listA2aDirectAgents, type A2aDirectAgent } from '@/lib/a2a/store';
import { FRONTIER_A2A_UI_REFRESH } from '@/lib/a2aUiRefreshBus';

export default function DirectListScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const [items, setItems] = useState<A2aDirectAgent[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const rows = await listA2aDirectAgents();
    setItems(rows);
    const token = await getA2aToken();
    const directoryNames = await fetchDiscoverableDisplayNamesForRpcUrls(rows.map((r) => r.agentUrl));
    const pairs = await Promise.all(
      rows.map(
        async (r) =>
          [r.agentUrl, await getAgentNameFromCard(r.agentUrl, token, { directoryNames })] as const
      )
    );
    setAgentNames(Object.fromEntries(pairs));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_UI_REFRESH, () => {
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const openAgent = (agentUrl: string) => {
    router.push({
      pathname: '/direct/agent',
      params: { url: agentUrl },
    });
  };

  return (
    <FlatList
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(i) => i.agentUrl}
      onRefresh={refresh}
      refreshing={false}
      ListHeaderComponent={null}
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.mutedText }]}>
          No direct agents yet.
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => openAgent(item.agentUrl)}
          style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
          <View style={[styles.card, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
            <View style={styles.cardTop}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                {agentNames[item.agentUrl] || 'Unknown Agent'}
              </Text>
              <FontAwesome name="chevron-right" size={17} color={colors.mutedText} />
            </View>
            <Text style={[styles.sub, { color: colors.mutedText }]}>Sessions: {item.sessionCount}</Text>
            <Text style={[styles.sub, { color: colors.mutedText }]}>
              Last active: {new Date(item.lastUpdatedAt).toLocaleString()}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  empty: { textAlign: 'center', marginTop: 24, lineHeight: 22, fontSize: 15 },
  card: { borderRadius: 16, padding: 18 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '600', flex: 1, marginRight: 8, letterSpacing: -0.2 },
  sub: { marginTop: 4, fontSize: 13, lineHeight: 18 },
});
