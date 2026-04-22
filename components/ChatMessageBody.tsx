import * as WebBrowser from 'expo-web-browser';
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { KatexWebView } from '@/components/KatexWebView';
import { McpUiBlocks } from '@/components/McpUiBlocks';
import { ThinkingTrace } from '@/components/ThinkingTrace';
import { unpackAssistantContent } from '@/lib/assistantTrace';
import type { ChatRole } from '@/lib/chatMemory';
import { splitMarkdownWithMath, splitMcpUiFences } from '@/lib/chatMessageSegments';

type AppColors = {
  text: string;
  tint: string;
  border: string;
  card: string;
  background: string;
};

function buildMarkdownStyles(colors: AppColors, isTool: boolean, isDark: boolean) {
  const codeSurface = isDark
    ? isTool
      ? 'rgba(255,255,255,0.1)'
      : 'rgba(255,255,255,0.08)'
    : isTool
      ? 'rgba(0,0,0,0.12)'
      : 'rgba(0,0,0,0.06)';
  const fontSize = isTool ? 13 : 16;
  const lineHeight = isTool ? 19 : 24;
  const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

  return {
    body: { color: colors.text, fontSize, lineHeight },
    heading1: { color: colors.text, fontSize: fontSize + 10, fontWeight: '700' as const, marginVertical: 6 },
    heading2: { color: colors.text, fontSize: fontSize + 6, fontWeight: '700' as const, marginVertical: 5 },
    heading3: { color: colors.text, fontSize: fontSize + 3, fontWeight: '700' as const, marginVertical: 4 },
    heading4: { color: colors.text, fontSize: fontSize + 1, fontWeight: '600' as const, marginVertical: 3 },
    heading5: { color: colors.text, fontWeight: '600' as const, marginVertical: 2 },
    heading6: { color: colors.text, fontWeight: '600' as const, opacity: 0.9, marginVertical: 2 },
    hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: 8 },
    strong: { fontWeight: '700' as const, color: colors.text },
    em: { fontStyle: 'italic' as const, color: colors.text },
    s: { textDecorationLine: 'line-through' as const, color: colors.text },
    blockquote: {
      backgroundColor: codeSurface,
      borderColor: colors.border,
      borderLeftWidth: 4,
      marginVertical: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { marginVertical: 2 },
    bullet_list_icon: { color: colors.tint, marginLeft: 4, marginRight: 8 },
    ordered_list_icon: { color: colors.text, marginLeft: 4, marginRight: 8, minWidth: 18 },
    code_inline: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: codeSurface,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: mono,
      fontSize: fontSize - 1,
      color: colors.text,
    },
    code_block: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: codeSurface,
      padding: 10,
      borderRadius: 8,
      fontFamily: mono,
      fontSize: fontSize - 2,
      color: colors.text,
      marginVertical: 6,
    },
    fence: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: codeSurface,
      padding: 10,
      borderRadius: 8,
      fontFamily: mono,
      fontSize: fontSize - 2,
      color: colors.text,
      marginVertical: 6,
    },
    table: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, marginVertical: 8 },
    thead: { backgroundColor: codeSurface },
    th: { color: colors.text, fontWeight: '600' as const, padding: 8, borderBottomWidth: 1, borderColor: colors.border },
    tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, flexDirection: 'row' as const },
    td: { color: colors.text, padding: 8, flex: 1 },
    link: { color: colors.tint, textDecorationLine: 'underline' as const },
    blocklink: { flex: 1, borderColor: colors.border, borderBottomWidth: 1 },
    paragraph: {
      marginTop: 4,
      marginBottom: 4,
      flexWrap: 'wrap' as const,
      flexDirection: 'row' as const,
    },
    text: { color: colors.text },
    textgroup: {},
  };
}

type Props = {
  /** Stable id (e.g. message row id) so math WebViews don’t reuse state across FlatList cells. */
  contentKey?: string;
  content: string;
  role: ChatRole;
  colors: AppColors;
  isDark: boolean;
};

export const ChatMessageBody = React.memo(function ChatMessageBody({
  contentKey = '',
  content,
  role,
  colors,
  isDark,
}: Props) {
  const isTool = role === 'tool';
  const toolStyles = useMemo(() => buildMarkdownStyles(colors, true, isDark), [colors, isDark]);

  const assistantUnpack =
    role === 'assistant' ? unpackAssistantContent(content) : { trace: null, body: content };

  if (isTool) {
    return (
      <View style={{ width: '100%' }}>
        <Markdown
          style={toolStyles}
          onLinkPress={(url) => {
            WebBrowser.openBrowserAsync(url).catch(() => {});
            return true;
          }}>
          {content}
        </Markdown>
      </View>
    );
  }

  const segments = splitMcpUiFences(assistantUnpack.body);

  return (
    <View style={{ width: '100%' }}>
      {assistantUnpack.trace?.length ? (
        <ThinkingTrace steps={assistantUnpack.trace} colors={colors} isDark={isDark} defaultOpen={false} />
      ) : null}
      {segments.map((seg, si) => {
        const mk = (suffix: string) => (contentKey ? `${contentKey}-${suffix}` : suffix);
        if (seg.type === 'mcpUi') {
          return <McpUiBlocks key={mk(`ui-${si}`)} rawJson={seg.rawJson} colors={colors} />;
        }
        const mathParts = splitMarkdownWithMath(seg.text);
        return (
          <View key={mk(`md-${si}`)} style={{ width: '100%' }}>
            {mathParts.map((p, pi) => {
              if (p.kind === 'markdown') {
                if (!p.text.trim()) return <View key={mk(`e-${si}-${pi}`)} />;
                return (
                  <Markdown
                    key={mk(`t-${si}-${pi}`)}
                    style={buildMarkdownStyles(colors, false, isDark)}
                    onLinkPress={(url) => {
                      WebBrowser.openBrowserAsync(url).catch(() => {});
                      return true;
                    }}>
                    {p.text}
                  </Markdown>
                );
              }
              return (
                <View key={mk(`k-${si}-${pi}`)} collapsable={false} style={{ width: '100%' }}>
                  <KatexWebView
                    latex={p.latex}
                    displayMode={p.kind === 'mathBlock'}
                    textColor={colors.text}
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
});
