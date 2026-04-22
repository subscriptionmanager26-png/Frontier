import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { cardShadow, topBarShadow } from '@/constants/shadows';
import { useChatKeyboardDiagLog } from '@/hooks/useChatKeyboardPreferences';
import { type AgentUiMessage } from '@/hooks/useAgent';
import { useAgentChannel } from '@/contexts/AgentChannelContext';
import { listThreadRoots, messagesInThreadOrdered, previewText } from '@/lib/threadMessages';

import { AgentChannelChrome } from '@/components/AgentChannelChrome';

const COMPOSER_BOTTOM_INSET_TRIM_WHEN_CLOSED = 10;
const COMPOSER_BOTTOM_MIN_WHEN_CLOSED = 0;
const COMPOSER_BOTTOM_WHEN_KEYBOARD_OPEN = 0;

type Props = {
  onOpenThread: (rootId: string) => void;
  inputPlaceholder?: string;
  emptyHint?: string;
  /** Renders an Updates control in the Remote / Connect bar (Direct agent hub). */
  onOpenSubscriptionUpdates?: () => void;
};

function logChatKeyboard(payload: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log('[ChatKeyboard]', JSON.stringify(payload));
}

export function AgentThreadListScreen({
  onOpenThread,
  inputPlaceholder,
  emptyHint,
  onOpenSubscriptionUpdates,
}: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const listRef = useRef<FlatList<AgentUiMessage>>(null);
  const [draft, setDraft] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const diagLog = useChatKeyboardDiagLog();
  const {
    messages,
    sending,
    send,
    hasMessages,
    remoteState,
    connectRemote,
    activeSubscriptions,
    unsubscribe,
    deleteThread,
  } =
    useAgentChannel();
  const threadRoots = useMemo(() => listThreadRoots(messages), [messages]);

  const composerBottomPad = keyboardOpen
    ? COMPOSER_BOTTOM_WHEN_KEYBOARD_OPEN
    : Math.max(insets.bottom - COMPOSER_BOTTOM_INSET_TRIM_WHEN_CLOSED, COMPOSER_BOTTOM_MIN_WHEN_CLOSED);

  const lastComposerLayoutLogAt = useRef(0);
  const lastComposerY = useRef<number | null>(null);

  useEffect(() => {
    if (!diagLog) return;
    logChatKeyboard({
      event: 'thread_list_mount',
      platform: Platform.OS,
      safeArea: { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right },
      window: Dimensions.get('window'),
    });
  }, [diagLog, insets.top, insets.bottom, insets.left, insets.right]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const onComposerLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!diagLog) return;
      const { x, y, width, height } = e.nativeEvent.layout;
      const now = Date.now();
      const yChanged = lastComposerY.current === null || Math.abs(y - lastComposerY.current) >= 8;
      if (now - lastComposerLayoutLogAt.current < 450 && !yChanged) return;
      lastComposerLayoutLogAt.current = now;
      lastComposerY.current = y;
      logChatKeyboard({
        event: 'composer_onLayout',
        layout: { x, y, width, height },
        composerBottomPadApplied: composerBottomPad,
        keyboardOpen,
      });
    },
    [diagLog, composerBottomPad, keyboardOpen]
  );

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(t);
  }, [threadRoots.length]);

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    await send(text, undefined);
  };

  const defaultEmpty = emptyHint || 'No messages yet.';

  const notifyThreadDeleted = useCallback(() => {
    const msg = 'Chat deleted from device and backup.';
    if (Platform.OS === 'android') {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
      return;
    }
    Alert.alert('Deleted', msg);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: AgentUiMessage }) => {
      const threadMsgs = messagesInThreadOrdered(messages, item.id);
      const replyCount = Math.max(0, threadMsgs.length - 1);
      const preview =
        item.role === 'user'
          ? previewText(item.text || '', 120)
          : previewText(item.text || '', 120) || '(assistant message)';
      return (
        <Pressable
          style={[styles.threadCard, { backgroundColor: colors.card }, cardShadow(isDark)]}
          onPress={() => onOpenThread(item.id)}
          onLongPress={() =>
            Alert.alert('Thread', 'Delete this thread from this device?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  deleteThread(item.id);
                  notifyThreadDeleted();
                },
              },
            ])
          }
          delayLongPress={450}
          accessibilityRole="button"
          accessibilityLabel={`Open thread, ${replyCount} replies`}>
          <View style={styles.threadCardBody}>
            <Text style={[styles.threadPreview, { color: colors.text }]} numberOfLines={3}>
              {preview}
            </Text>
            <Text style={[styles.threadMeta, { color: colors.mutedText }]}>
              {replyCount === 0 ? 'No replies yet' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
            </Text>
          </View>
          <FontAwesome
            name="chevron-right"
            size={14}
            color={colors.mutedText}
            style={styles.threadChevron}
          />
        </Pressable>
      );
    },
    [colors.card, colors.mutedText, colors.text, isDark, messages, onOpenThread, deleteThread, notifyThreadDeleted]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AgentChannelChrome
        colors={colors}
        remoteState={remoteState}
        connectRemote={connectRemote}
        activeSubscriptions={activeSubscriptions}
        unsubscribe={unsubscribe}
        onOpenSubscriptionUpdates={onOpenSubscriptionUpdates}
      />
      <FlatList<AgentUiMessage>
        ref={listRef}
        data={threadRoots}
        keyExtractor={(m) => m.id}
        style={styles.list}
        contentContainerStyle={[styles.content, { paddingBottom: 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        renderItem={renderItem}
        initialNumToRender={12}
        ListEmptyComponent={
          !hasMessages ? (
            <Text style={[styles.empty, { color: colors.mutedText }]}>{defaultEmpty}</Text>
          ) : null
        }
      />
      <KeyboardStickyView style={styles.sticky} offset={{ closed: 0, opened: 0 }}>
        <View
          onLayout={onComposerLayout}
          style={[
            styles.inputKeyboardWrap,
            { backgroundColor: colors.card, paddingBottom: composerBottomPad },
            topBarShadow(isDark),
          ]}>
          <View style={[styles.inputRow, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.engagement }]}
              placeholder={inputPlaceholder || 'New message…'}
              placeholderTextColor={colors.mutedText}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={4000}
              editable={!sending}
            />
            <Pressable
              onPress={onSend}
              disabled={sending || !draft.trim()}
              style={[
                styles.sendBtn,
                { backgroundColor: colors.tint, opacity: sending || !draft.trim() ? 0.5 : 1 },
              ]}>
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <FontAwesome name="send" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sticky: { width: '100%' },
  list: { flex: 1 },
  inputKeyboardWrap: { width: '100%' },
  content: { padding: 16, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: 32, lineHeight: 20 },
  threadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  threadCardBody: { flex: 1, minWidth: 0 },
  threadPreview: { fontSize: 15, lineHeight: 21 },
  threadMeta: { fontSize: 12, marginTop: 6 },
  threadChevron: { marginLeft: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
