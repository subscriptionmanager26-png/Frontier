import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChatMessageBody } from '@/components/ChatMessageBody';
import { DslRenderer } from '@/components/agent/DslRenderer';
import { Text } from '@/components/Themed';
import { classifyAgentPayload } from '@/lib/dslUi';

type Colors = {
  text: string;
  tint: string;
  border: string;
  card: string;
  background: string;
};

type Props = {
  /** Stable key for nested WebViews / lists. */
  contentKey: string;
  body: string;
  colors: Colors;
  isDark: boolean;
};

/**
 * Renders subscription task output like assistant messages: DSL (`root =`) via DslRenderer; structured JSON text;
 * otherwise ChatMessageBody (markdown, mcp-ui fences, math).
 */
export function SubscriptionUpdatePayload({ contentKey, body, colors, isDark }: Props) {
  const classified = useMemo(() => classifyAgentPayload(body || ''), [body]);

  const appColors = useMemo(
    () => ({
      text: colors.text,
      tint: colors.tint,
      border: colors.border,
      card: colors.card,
      background: colors.background,
    }),
    [colors]
  );

  if (!body.trim()) {
    return null;
  }

  if (classified.kind === 'dsl') {
    return (
      <View style={styles.block}>
        <DslRenderer dsl={classified.dsl} />
      </View>
    );
  }

  if (classified.kind === 'text_json') {
    return (
      <Text style={[styles.plain, { color: colors.text }]} selectable>
        {classified.content}
      </Text>
    );
  }

  return (
    <View style={styles.block}>
      <ChatMessageBody
        contentKey={contentKey}
        content={classified.kind === 'plain' ? classified.content : body}
        role="assistant"
        colors={appColors}
        isDark={isDark}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { width: '100%', marginTop: 4 },
  plain: { fontSize: 15, lineHeight: 22 },
});
