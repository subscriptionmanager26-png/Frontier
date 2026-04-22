import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AgentChatScreen } from '@/components/AgentChatScreen';
import { Text as ThemedText } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getA2aToken } from '@/lib/appSettings';
import { getAgentNameFromCard } from '@/lib/a2a/agentCard';
import { touchDirectAgentRecent } from '@/lib/a2a/store';

function pickUrl(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || !v.trim()) return '';
  const t = v.trim();
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

function pickThread(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

/**
 * Direct thread conversation: requires `thread` (root message id). Opens from the agent hub.
 * `/direct/chat?url=` without `thread` redirects to the hub (`/direct/agent`).
 */
export default function DirectChatRoute() {
  const { url: urlParam, thread: threadParam, displayName: displayNameParam } = useLocalSearchParams<{
    url?: string;
    thread?: string;
    displayName?: string;
  }>();
  const agentUrl = pickUrl(urlParam);
  const displayNameHint = pickUrl(displayNameParam);
  const threadRootId = pickThread(threadParam);
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

  const [displayName, setDisplayName] = useState(() => displayNameHint || 'Agent');

  const scope =
    agentUrl ? ({ kind: 'direct' as const, agentUrl }) : ({ kind: 'default' as const });

  useEffect(() => {
    if (!agentUrl) return;
    setDisplayName(displayNameHint || 'Agent');
    let cancelled = false;
    void (async () => {
      const token = await getA2aToken();
      const n = await getAgentNameFromCard(agentUrl, token, { hint: displayNameHint || undefined });
      if (!cancelled) setDisplayName(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentUrl, displayNameHint]);

  useEffect(() => {
    if (!agentUrl || !threadRootId) return;
    void touchDirectAgentRecent(agentUrl);
  }, [agentUrl, threadRootId]);

  useEffect(() => {
    if (!agentUrl || threadRootId) return;
    router.replace({
      pathname: '/direct/agent',
      params:
        displayNameHint && displayNameHint !== 'Agent'
          ? { url: agentUrl, displayName: displayNameHint }
          : { url: agentUrl },
    });
  }, [agentUrl, threadRootId, router, displayNameHint]);

  if (!agentUrl) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ThemedText style={{ color: colors.mutedText }}>No agent URL.</ThemedText>
      </View>
    );
  }

  if (!threadRootId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.tint} />
      </View>
    );
  }

  return (
    <AgentChatScreen
      scope={scope}
      channelTitle={displayName}
      inputPlaceholder={`Message ${displayName}…`}
      threadOnly
      initialThreadRootId={threadRootId}
      onExitThread={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
