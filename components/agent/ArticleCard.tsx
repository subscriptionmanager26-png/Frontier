import { Linking, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { ArticleCardProps } from '@/lib/agent/tools';

export function ArticleCard(props: ArticleCardProps) {
  const { headline, source, summary, publishedAt, url } = props;
  const colors = Colors[useColorScheme() ?? 'light'];
  const onOpen = async () => {
    if (url) await Linking.openURL(url);
  };
  return (
    <Pressable
      disabled={!url}
      onPress={onOpen}
      style={[styles.card, { borderColor: colors.border, opacity: url ? 1 : 0.95 }]}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={[styles.meta, { color: colors.mutedText }]}>
        {source} - {publishedAt}
      </Text>
      <Text style={styles.summary}>{summary}</Text>
      {url ? (
        <View style={styles.footer}>
          <Text style={{ color: colors.tint, fontWeight: '600' }}>Open article</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  headline: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  meta: { marginTop: 6, fontSize: 12 },
  summary: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  footer: { marginTop: 10, alignItems: 'flex-start' },
});
