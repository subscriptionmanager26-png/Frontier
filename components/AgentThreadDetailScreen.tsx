import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentMessageRow } from '@/components/AgentMessageRow';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { topBarShadow } from '@/constants/shadows';
import { useChatKeyboardDiagLog } from '@/hooks/useChatKeyboardPreferences';
import { type AgentUiMessage } from '@/hooks/useAgent';
import { useAgentChannel } from '@/contexts/AgentChannelContext';
import { messagesInThreadOrdered } from '@/lib/threadMessages';
import { parentReplyPreview } from '@/lib/replyPreview';

const COMPOSER_BOTTOM_INSET_TRIM_WHEN_CLOSED = 10;
const COMPOSER_BOTTOM_MIN_WHEN_CLOSED = 0;
const COMPOSER_BOTTOM_WHEN_KEYBOARD_OPEN = 0;

type Props = {
  rootId: string;
  inputPlaceholder?: string;
};

function logChatKeyboard(payload: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log('[ChatKeyboard]', JSON.stringify(payload));
}

export function AgentThreadDetailScreen({ rootId, inputPlaceholder }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const listRef = useRef<FlatList<AgentUiMessage>>(null);
  const [draft, setDraft] = useState('');
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const diagLog = useChatKeyboardDiagLog();
  const { messages, sending, send, unsubscribe, trackTaskUpdates, dslEnabled, classifyAgentPayload } = useAgentChannel();

  const threadMessages = useMemo(() => messagesInThreadOrdered(messages, rootId), [messages, rootId]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const composerBottomPad = keyboardOpen
    ? COMPOSER_BOTTOM_WHEN_KEYBOARD_OPEN
    : Math.max(insets.bottom - COMPOSER_BOTTOM_INSET_TRIM_WHEN_CLOSED, COMPOSER_BOTTOM_MIN_WHEN_CLOSED);

  const lastComposerLayoutLogAt = useRef(0);
  const lastComposerY = useRef<number | null>(null);

  useEffect(() => {
    if (!diagLog) return;
    logChatKeyboard({
      event: 'thread_detail_mount',
      rootId,
      platform: Platform.OS,
      window: Dimensions.get('window'),
    });
  }, [diagLog, rootId]);

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
  }, [threadMessages.length]);

  const scrollToMessageId = useCallback(
    (messageId: string) => {
      const index = threadMessages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
      });
    },
    [threadMessages]
  );

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    const explicitReply = replyDraftId;
    setReplyDraftId(null);
    // Keep message in this thread even when not an explicit reply.
    const effectiveReply = explicitReply ?? rootId;
    await send(text, effectiveReply);
  };

  const onReply = useCallback((messageId: string) => {
    setReplyDraftId(messageId);
  }, []);

  const onUnsubscribe = useCallback(
    (id: string) => {
      void unsubscribe(id);
    },
    [unsubscribe]
  );

  const renderItem = useCallback(
    ({ item }: { item: AgentUiMessage }) => {
      const parent = item.replyToId ? messageById.get(item.replyToId) : undefined;
      const replyPreview =
        item.replyToId != null && item.replyToId !== '' && item.replyToId !== rootId
          ? parentReplyPreview(parent, classifyAgentPayload) ?? { mode: 'text' as const, excerpt: 'Earlier message' }
          : null;
      return (
        <AgentMessageRow
          item={item}
          replyPreview={replyPreview}
          onPressReplyTarget={() => {
            if (item.replyToId) scrollToMessageId(item.replyToId);
          }}
          colors={colors}
          dslEnabled={dslEnabled}
          classifyAgentPayload={classifyAgentPayload}
          onUnsubscribe={onUnsubscribe}
          onReply={onReply}
          onTrackUpdates={(taskId) => {
            void trackTaskUpdates(taskId);
          }}
        />
      );
    },
    [classifyAgentPayload, colors, dslEnabled, messageById, onReply, onUnsubscribe, scrollToMessageId, trackTaskUpdates]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList<AgentUiMessage>
        ref={listRef}
        data={threadMessages}
        keyExtractor={(m) => m.id}
        style={styles.list}
        contentContainerStyle={[styles.content, { paddingBottom: 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        renderItem={renderItem}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.2,
            });
          }, 150);
        }}
        initialNumToRender={12}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.mutedText }]}>This thread is empty.</Text>
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
          {replyDraftId ? (
            <View style={[styles.replyingBar, { borderBottomColor: colors.border, backgroundColor: colors.surfaceTint }]}>
              <Pressable
                style={styles.replyingBarPreview}
                onPress={() => scrollToMessageId(replyDraftId)}
                accessibilityRole="button"
                accessibilityLabel="View message you are replying to">
                {(() => {
                  const draftParent = messageById.get(replyDraftId);
                  const draftPreview = parentReplyPreview(draftParent, classifyAgentPayload);
                  if (!draftPreview) {
                    return (
                      <Text style={[styles.replyingBarText, { color: colors.mutedText }]} numberOfLines={2}>
                        Replying to message
                      </Text>
                    );
                  }
                  return (
                    <View style={styles.replyLineInner}>
                      <FontAwesome name="reply" size={14} color={colors.mutedText} style={styles.replyGlyph} />
                      {draftPreview.mode === 'text' ? (
                        <Text style={[styles.replyingBarText, { color: colors.text }]} numberOfLines={3}>
                          {draftPreview.excerpt}
                        </Text>
                      ) : (
                        <>
                          <Text style={[styles.replyAttached, { color: colors.text }]}>
                            attached {draftPreview.noun}
                          </Text>
                          <FontAwesome
                            name={draftPreview.icon as ComponentProps<typeof FontAwesome>['name']}
                            size={16}
                            color={colors.mutedText}
                          />
                          {draftPreview.label ? (
                            <Text style={[styles.replyPartName, { color: colors.mutedText }]} numberOfLines={2}>
                              {draftPreview.label}
                            </Text>
                          ) : null}
                        </>
                      )}
                    </View>
                  );
                })()}
              </Pressable>
              <Pressable onPress={() => setReplyDraftId(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                <Text style={{ color: colors.tint, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.inputRow, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.engagement }]}
              placeholder={inputPlaceholder || 'Reply…'}
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
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  replyingBarPreview: { flex: 1, minWidth: 0 },
  replyingBarText: { flex: 1, fontSize: 13, lineHeight: 18 },
  replyLineInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    maxWidth: '100%',
  },
  replyGlyph: { marginTop: 1 },
  replyAttached: { fontSize: 12, fontWeight: '600' },
  replyPartName: { fontSize: 12, flexShrink: 1 },
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
