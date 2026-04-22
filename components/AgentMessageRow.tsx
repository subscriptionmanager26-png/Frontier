import FontAwesome from '@expo/vector-icons/FontAwesome';
import { memo, useCallback, type ComponentProps } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { AccessibilityActionEvent } from 'react-native';

import { AgentRenderer } from '@/components/agent/AgentRenderer';
import { DslRenderer } from '@/components/agent/DslRenderer';
import { Text } from '@/components/Themed';
import type { AgentUiMessage } from '@/hooks/useAgent';
import { type ReplyPreview } from '@/lib/replyPreview';

type Colors = {
  text: string;
  mutedText: string;
  tint: string;
  border: string;
  surfaceTint: string;
};

type Props = {
  item: AgentUiMessage;
  replyPreview: ReplyPreview | null;
  onPressReplyTarget: () => void;
  colors: Colors;
  dslEnabled: boolean;
  classifyAgentPayload: (raw: string) => {
    kind: 'dsl';
    dsl: string;
  } | { kind: 'text_json'; content: string } | { kind: 'plain'; content: string };
  onUnsubscribe: (id: string) => void;
  onReply: (messageId: string) => void;
  onTrackUpdates: (taskId: string, sessionId?: string) => void;
};

export const AgentMessageRow = memo(function AgentMessageRow({
  item,
  replyPreview,
  onPressReplyTarget,
  colors,
  dslEnabled,
  classifyAgentPayload,
  onUnsubscribe,
  onReply,
  onTrackUpdates,
}: Props) {
  const classified = item.role === 'assistant' && item.text ? classifyAgentPayload(item.text) : null;

  const showReplyMenu = useCallback(() => {
    const reply = () => onReply(item.id);
    const track =
      item.taskId && item.taskId.trim()
        ? {
            text: 'Track Updates',
            onPress: () => onTrackUpdates(item.taskId!),
          }
        : null;
    Alert.alert(
      'Message',
      undefined,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Reply', onPress: reply }, ...(track ? [track] : [])]
    );
  }, [item.id, item.taskId, onReply, onTrackUpdates]);

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'reply') onReply(item.id);
    },
    [item.id, onReply]
  );

  return (
    <View style={[item.role === 'user' ? styles.userRow : styles.assistantRow]}>
      {replyPreview ? (
        <Pressable
          onPress={onPressReplyTarget}
          style={[
            styles.replyLineWrap,
            item.role === 'user' ? styles.replyLineWrapUser : styles.replyLineWrapAssistant,
          ]}
          accessibilityRole="button"
          accessibilityLabel="View original message this reply refers to">
          <View style={styles.replyLineInner}>
            <FontAwesome name="reply" size={14} color={colors.mutedText} style={styles.replyGlyph} />
            {replyPreview.mode === 'text' ? (
              <Text style={[styles.replyTextPreview, { color: colors.text }]} numberOfLines={4}>
                {replyPreview.excerpt}
              </Text>
            ) : (
              <>
                <Text style={[styles.replyAttached, { color: colors.text }]}>attached {replyPreview.noun}</Text>
                <FontAwesome
                  name={replyPreview.icon as ComponentProps<typeof FontAwesome>['name']}
                  size={16}
                  color={colors.mutedText}
                />
                {replyPreview.label ? (
                  <Text style={[styles.replyPartName, { color: colors.mutedText }]} numberOfLines={2}>
                    {replyPreview.label}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </Pressable>
      ) : null}
      {item.role === 'user' ? (
        <Pressable
          onLongPress={showReplyMenu}
          delayLongPress={500}
          style={[styles.messagePressable, styles.messagePressableUser]}
          accessibilityHint="Long press for actions"
          accessibilityActions={[{ name: 'reply', label: 'Reply to message' }]}
          onAccessibilityAction={onAccessibilityAction}>
          <View style={[styles.userBubble, { backgroundColor: colors.tint }]}>
            {item.text ? <Text style={styles.userText}>{item.text}</Text> : null}
          </View>
        </Pressable>
      ) : (
        <View style={styles.assistantMainRow}>
          <Pressable
            onLongPress={showReplyMenu}
            delayLongPress={500}
            style={[styles.messagePressable, styles.messagePressableAssistant]}
            accessibilityHint="Long press for actions"
            accessibilityActions={[{ name: 'reply', label: 'Reply to message' }]}
            onAccessibilityAction={onAccessibilityAction}>
            <View style={styles.assistantContent}>
              {item.text && classified ? (
                dslEnabled && classified.kind === 'dsl' ? (
                  <DslRenderer dsl={classified.dsl} />
                ) : classified.kind === 'text_json' ? (
                  <Text style={[styles.assistantText, { color: colors.text }]}>{classified.content}</Text>
                ) : (
                  <Text style={[styles.assistantText, { color: colors.text }]}>
                    {classified.kind === 'plain' ? classified.content : item.text}
                  </Text>
                )
              ) : null}
              {item.subscriptionEmissionRunCount != null && !item.subscription?.unsubscribeTaskId ? (
                <View style={styles.subInline}>
                  <Text style={[styles.chip, { borderColor: colors.mutedText, color: colors.mutedText }]}>
                    Update #{item.subscriptionEmissionRunCount}
                  </Text>
                </View>
              ) : null}
              {item.subscription?.unsubscribeTaskId ? (
                <View style={styles.subInline}>
                  <Text style={[styles.chip, { borderColor: colors.tint, color: colors.tint }]}>Subscribed</Text>
                  <Pressable onPress={() => onUnsubscribe(item.subscription!.unsubscribeTaskId!)}>
                    <Text style={{ color: colors.tint, fontSize: 12, fontWeight: '600' }}>Unsubscribe</Text>
                  </Pressable>
                </View>
              ) : null}
              {item.components?.map((c: NonNullable<AgentUiMessage['components']>[number]) => (
                <View key={c.id} style={styles.assistantBlock}>
                  <AgentRenderer component={c.component} props={c.props} />
                </View>
              ))}
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  replyLineWrap: { marginBottom: 6, maxWidth: '92%' },
  replyLineWrapUser: { alignSelf: 'flex-end' },
  replyLineWrapAssistant: { alignSelf: 'flex-start' },
  replyLineInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    maxWidth: '100%',
  },
  replyGlyph: { marginTop: 1 },
  replyTextPreview: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  replyAttached: { fontSize: 12, fontWeight: '600' },
  replyPartName: { fontSize: 12, flexShrink: 1 },
  messagePressable: { maxWidth: '100%' },
  messagePressableUser: { alignSelf: 'flex-end' },
  messagePressableAssistant: { flex: 1, minWidth: 0 },
  userRow: { alignItems: 'flex-end', marginBottom: 16, maxWidth: '100%' },
  assistantRow: { alignItems: 'flex-start', marginBottom: 16, width: '100%' },
  assistantMainRow: {
    width: '100%',
    paddingRight: 8,
  },
  userBubble: {
    maxWidth: '75%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userText: { fontSize: 15, lineHeight: 22, color: '#FFFFFF', fontWeight: '500' },
  assistantContent: { flex: 1, minWidth: 0, gap: 8 },
  assistantText: { fontSize: 15, lineHeight: 22 },
  assistantBlock: { width: '100%' },
  subInline: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '600',
  },
});
