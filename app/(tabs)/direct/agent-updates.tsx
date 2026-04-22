import { useNavigation } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DirectAgentUpdatesSection } from '@/components/DirectAgentUpdatesSection';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell } from '@/constants/appShell';
import { getA2aToken } from '@/lib/appSettings';
import { getAgentNameFromCard } from '@/lib/a2a/agentCard';

function pickUrl(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Full-screen subscription updates for one direct agent (opened from the agent hub).
 */
export default function DirectAgentUpdatesRoute() {
  const { url: urlParam } = useLocalSearchParams<{ url?: string }>();
  const agentUrl = pickUrl(urlParam);
  const navigation = useNavigation();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const shell = getShell(scheme === 'dark' ? 'dark' : 'light');

  const [displayName, setDisplayName] = useState('Updates');

  useEffect(() => {
    if (!agentUrl) return;
    let cancelled = false;
    void (async () => {
      const token = await getA2aToken();
      const n = await getAgentNameFromCard(agentUrl, token);
      if (!cancelled) setDisplayName(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentUrl]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: displayName });
  }, [navigation, displayName]);

  if (!agentUrl) {
    return (
      <View style={[styles.centered, { backgroundColor: shell.canvas }]}>
        <Text style={{ color: colors.mutedText }}>Missing agent URL.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: shell.canvas }]}>
      <DirectAgentUpdatesSection agentUrl={agentUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
