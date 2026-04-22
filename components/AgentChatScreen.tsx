import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';

import { AgentThreadDetailScreen } from '@/components/AgentThreadDetailScreen';
import { AgentThreadListScreen } from '@/components/AgentThreadListScreen';
import { Text } from '@/components/Themed';
import { HeaderIconButton } from '@/components/ui/HeaderIconButton';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AgentChannelProvider } from '@/contexts/AgentChannelContext';
import { type AgentChatScope } from '@/hooks/useAgent';

type Props = {
  scope: AgentChatScope;
  inputPlaceholder?: string;
  emptyHint?: string;
  /** Shown as the navigation title on the thread list (e.g. agent name). */
  channelTitle?: string;
  /**
   * Called when leaving a thread view so the parent screen can re-apply headerTitle / headerRight
   * (otherwise React Navigation keeps the thread header until overwritten).
   */
  onIdleHeaderRestore?: () => void;
  /** When set, open this thread immediately (e.g. pushed from agent hub). */
  initialThreadRootId?: string | null;
  /** If true, only thread detail is shown; exiting the thread calls `onExitThread` (e.g. `router.back()`). */
  threadOnly?: boolean;
  /** Used with `threadOnly`: Back / hardware back leaves the thread screen. */
  onExitThread?: () => void;
};

function AgentChatInner({
  inputPlaceholder,
  emptyHint,
  channelTitle,
  onIdleHeaderRestore,
  initialThreadRootId,
  threadOnly,
  onExitThread,
}: {
  inputPlaceholder?: string;
  emptyHint?: string;
  channelTitle?: string;
  onIdleHeaderRestore?: () => void;
  initialThreadRootId?: string | null;
  threadOnly?: boolean;
  onExitThread?: () => void;
}) {
  const navigation = useNavigation();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [threadRootId, setThreadRootId] = useState<string | null>(initialThreadRootId ?? null);

  useEffect(() => {
    if (initialThreadRootId != null && initialThreadRootId !== '') {
      setThreadRootId(initialThreadRootId);
    }
  }, [initialThreadRootId]);

  const leaveThread = useCallback(() => {
    if (onExitThread) {
      onExitThread();
    } else {
      setThreadRootId(null);
    }
  }, [onExitThread]);

  useEffect(() => {
    if (!threadRootId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveThread();
      return true;
    });
    return () => sub.remove();
  }, [threadRootId, leaveThread]);

  useLayoutEffect(() => {
    if (threadRootId) {
      navigation.setOptions({
        title: 'Thread',
        headerLeft: () => (
          <HeaderIconButton onPress={leaveThread} color={colors.mutedText} icon="chevron-left" />
        ),
        headerRight: undefined,
      });
    } else if (onIdleHeaderRestore) {
      onIdleHeaderRestore();
    } else {
      navigation.setOptions({
        title: channelTitle ?? 'Channel',
        headerLeft: undefined,
        headerRight: undefined,
      });
    }
  }, [
    threadRootId,
    channelTitle,
    navigation,
    colors.mutedText,
    onIdleHeaderRestore,
    leaveThread,
  ]);

  if (threadOnly) {
    if (!threadRootId) {
      return (
        <View style={styles.threadOnlyFallback}>
          <ActivityIndicator />
        </View>
      );
    }
    return <AgentThreadDetailScreen rootId={threadRootId} inputPlaceholder={inputPlaceholder} />;
  }

  if (threadRootId) {
    return <AgentThreadDetailScreen rootId={threadRootId} inputPlaceholder={inputPlaceholder} />;
  }

  return (
    <AgentThreadListScreen onOpenThread={setThreadRootId} inputPlaceholder={inputPlaceholder} emptyHint={emptyHint} />
  );
}

export function AgentChatScreen({
  scope,
  inputPlaceholder,
  emptyHint,
  channelTitle,
  onIdleHeaderRestore,
  initialThreadRootId,
  threadOnly,
  onExitThread,
}: Props) {
  return (
    <AgentChannelProvider scope={scope}>
      <AgentChatInner
        inputPlaceholder={inputPlaceholder}
        emptyHint={emptyHint}
        channelTitle={channelTitle}
        onIdleHeaderRestore={onIdleHeaderRestore}
        initialThreadRootId={initialThreadRootId}
        threadOnly={threadOnly}
        onExitThread={onExitThread}
      />
    </AgentChannelProvider>
  );
}

const styles = StyleSheet.create({
  threadOnlyFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
