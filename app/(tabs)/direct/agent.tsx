import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentCardView } from '@/components/AgentCardView';
import { AgentThreadListScreen } from '@/components/AgentThreadListScreen';
import { Text as ThemedText } from '@/components/Themed';
import { HeaderIconButton } from '@/components/ui/HeaderIconButton';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell } from '@/constants/appShell';
import { AgentChannelProvider } from '@/contexts/AgentChannelContext';
import { getA2aToken } from '@/lib/appSettings';
import { fetchAgentCardDocument, getAgentNameFromCard } from '@/lib/a2a/agentCard';
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

/**
 * Direct → tap an agent: Updates row + Check opens subscription feed; threads below.
 */
export default function DirectAgentHubScreen() {
  const { url: urlParam, displayName: displayNameHintParam } = useLocalSearchParams<{
    url?: string;
    displayName?: string;
  }>();
  const agentUrl = pickUrl(urlParam);
  const displayNameHint = pickUrl(displayNameHintParam);
  const router = useRouter();
  const navigation = useNavigation();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const shell = getShell(scheme === 'dark' ? 'dark' : 'light');
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState(() => displayNameHint || 'Agent');
  const [cardOpen, setCardOpen] = useState(false);
  const [cardDoc, setCardDoc] = useState<unknown | null | 'loading'>(null);
  /** Remount thread channel when returning from `/direct/chat` so storage is re-read. */
  const [channelKey, setChannelKey] = useState(0);
  const skipNextChannelRemount = useRef(true);

  const scope =
    agentUrl ? ({ kind: 'direct' as const, agentUrl }) : ({ kind: 'default' as const });

  useFocusEffect(
    useCallback(() => {
      if (skipNextChannelRemount.current) {
        skipNextChannelRemount.current = false;
        return;
      }
      setChannelKey((k) => k + 1);
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!agentUrl) return;
      void touchDirectAgentRecent(agentUrl);
    }, [agentUrl])
  );

  useEffect(() => {
    if (!agentUrl) return;
    setDisplayName(displayNameHint || 'Agent');
    let cancelled = false;
    void (async () => {
      const token = await getA2aToken();
      const n = await getAgentNameFromCard(agentUrl, token, { hint: displayNameHint || undefined });
      if (cancelled) return;
      if (n !== 'Unknown Agent') setDisplayName(n);
      else if (displayNameHint) setDisplayName(displayNameHint);
      else setDisplayName(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentUrl, displayNameHint]);

  const openAgentCard = useCallback(async () => {
    if (!agentUrl) return;
    setCardOpen(true);
    setCardDoc('loading');
    const token = await getA2aToken();
    const doc = await fetchAgentCardDocument(agentUrl, token);
    setCardDoc(doc);
  }, [agentUrl]);

  const openUpdates = useCallback(() => {
    if (!agentUrl) return;
    router.push({ pathname: '/direct/agent-updates', params: { url: agentUrl } });
  }, [router, agentUrl]);

  useLayoutEffect(() => {
    if (!agentUrl) return;
    navigation.setOptions({
      headerTitleAlign: 'center',
      headerTitle: () => (
        <Text style={[styles.headerTitleText, { color: colors.text }]} numberOfLines={1}>
          {displayName}
        </Text>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => void openAgentCard()}
          hitSlop={12}
          accessibilityLabel="Agent card"
          accessibilityRole="button"
          style={{ marginRight: Math.max(8, insets.right), padding: 8 }}>
          <FontAwesome name="info-circle" size={22} color={colors.tint} />
        </Pressable>
      ),
    });
  }, [navigation, displayName, colors.text, colors.tint, agentUrl, openAgentCard, insets.right]);

  const openThread = useCallback(
    (rootId: string) => {
      router.push({
        pathname: '/direct/chat',
        params:
          displayName && displayName !== 'Agent'
            ? { url: agentUrl, thread: rootId, displayName }
            : { url: agentUrl, thread: rootId },
      });
    },
    [router, agentUrl, displayName]
  );

  if (!agentUrl) {
    return (
      <View style={[styles.centered, { backgroundColor: shell.canvas }]}>
        <Text style={{ color: colors.mutedText }}>Missing agent URL.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.root, { backgroundColor: shell.canvas }]}>
        <AgentChannelProvider key={channelKey} scope={scope}>
          <AgentThreadListScreen
            onOpenThread={openThread}
            inputPlaceholder={`Message ${displayName}…`}
            onOpenSubscriptionUpdates={openUpdates}
          />
        </AgentChannelProvider>
      </View>
      <Modal visible={cardOpen} animationType="slide" transparent onRequestClose={() => setCardOpen(false)}>
        <View style={[styles.modalBackdrop, { paddingTop: insets.top }]}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>Agent card</ThemedText>
              <HeaderIconButton
                onPress={() => setCardOpen(false)}
                color={colors.tint}
                icon="times"
                accessibilityLabel="Close agent card"
              />
            </View>
            <ThemedText style={[styles.modalUrl, { color: colors.mutedText }]} selectable numberOfLines={3}>
              {agentUrl}
            </ThemedText>
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              {cardDoc === 'loading' ? (
                <ActivityIndicator color={colors.tint} style={{ marginTop: 24 }} />
              ) : cardDoc == null ? (
                <ThemedText style={{ color: colors.mutedText, marginTop: 16 }}>
                  Could not load the agent card from this endpoint.
                </ThemedText>
              ) : (
                <AgentCardView
                  doc={cardDoc}
                  fallbackUrl={agentUrl}
                  colors={{
                    text: colors.text,
                    mutedText: colors.mutedText,
                    tint: colors.tint,
                    border: colors.border,
                    engagement: colors.engagement,
                  }}
                />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerTitleText: { fontSize: 17, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalUrl: { fontSize: 12, paddingHorizontal: 16, marginBottom: 8 },
  modalScroll: { maxHeight: 480 },
  modalScrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
});
