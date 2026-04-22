import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Audio, ResizeMode, Video } from 'expo-av';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import type { McpUiBlock, McpUiPayload } from '@/lib/mcpUiContract';
import { parseMcpUiPayload } from '@/lib/mcpUiContract';

type Colors = {
  text: string;
  tint: string;
  border: string;
  card: string;
};

export function McpUiBlocks({ rawJson, colors }: { rawJson: string; colors: Colors }) {
  const parsed: McpUiPayload | null = parseMcpUiPayload(rawJson);
  if (!parsed) {
    return (
      <View style={[styles.invalid, { borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontSize: 12, opacity: 0.7 }}>
          Could not parse mcp-ui block (invalid JSON or schema).
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {parsed.blocks.map((b, i) => (
        <Block key={i} block={b} colors={colors} />
      ))}
    </View>
  );
}

function Block({ block, colors }: { block: McpUiBlock; colors: Colors }) {
  switch (block.type) {
    case 'notice': {
      const bg =
        block.variant === 'success'
          ? 'rgba(52,199,89,0.12)'
          : block.variant === 'warning'
            ? 'rgba(255,149,0,0.15)'
            : block.variant === 'error'
              ? 'rgba(255,59,48,0.12)'
              : 'rgba(10,132,255,0.12)';
      return (
        <View style={[styles.notice, { backgroundColor: bg, borderColor: colors.border }]}>
          {block.title ? (
            <Text style={[styles.noticeTitle, { color: colors.text }]}>{block.title}</Text>
          ) : null}
          <Text style={[styles.noticeBody, { color: colors.text }]}>{block.body}</Text>
        </View>
      );
    }
    case 'keyValue':
      return (
        <View style={[styles.kvCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {block.rows.map((row, j) => (
            <View
              key={j}
              style={[styles.kvRow, j > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.kvK, { color: colors.text }]}>{row.k}</Text>
              <Text style={[styles.kvV, { color: colors.text }]} selectable>
                {row.v}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'bulletList':
      return (
        <View style={styles.list}>
          {block.items.map((item, j) => (
            <View key={j} style={styles.listRow}>
              <Text style={[styles.bullet, { color: colors.tint }]}>•</Text>
              <Text style={[styles.listText, { color: colors.text }]} selectable>
                {item}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'buttonRow':
      return (
        <View style={styles.btnRow}>
          {block.buttons.map((btn, j) => (
            <Pressable
              key={j}
              onPress={async () => {
                await Clipboard.setStringAsync(btn.actionId);
                Alert.alert('Copied', `Suggested follow-up copied:\n${btn.actionId.slice(0, 200)}${btn.actionId.length > 200 ? '…' : ''}`);
              }}
              style={({ pressed }) => [
                styles.btn,
                { borderColor: colors.tint, opacity: pressed ? 0.75 : 1 },
              ]}>
              <Text style={{ color: colors.tint, fontWeight: '600', fontSize: 14 }}>{btn.label}</Text>
            </Pressable>
          ))}
        </View>
      );
    case 'image': {
      const ratio = computeAspectRatio(block.src.width, block.src.height);
      return (
        <Pressable
          onPress={() => openUrl(block.src.url)}
          style={[styles.mediaCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Image
            source={{ uri: block.src.url }}
            style={[styles.image, { aspectRatio: ratio }]}
            resizeMode={block.fit === 'contain' ? 'contain' : 'cover'}
          />
          {block.alt || block.src.caption ? (
            <Text style={[styles.mediaCaption, { color: colors.text }]}>
              {block.alt ?? block.src.caption}
            </Text>
          ) : null}
        </Pressable>
      );
    }
    case 'video': {
      const ratio = computeAspectRatio(block.src.width, block.src.height);
      return (
        <View style={[styles.mediaCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Video
            source={{ uri: block.src.url }}
            style={[styles.video, { aspectRatio: ratio }]}
            useNativeControls
            shouldPlay={block.autoplay}
            isLooping={block.loop}
            isMuted={block.muted}
            resizeMode={ResizeMode.CONTAIN}
            posterSource={block.src.posterUrl ? { uri: block.src.posterUrl } : undefined}
            usePoster={!!block.src.posterUrl}
          />
          <View style={styles.mediaRow}>
            <Pressable
              onPress={() => openUrl(block.src.url)}
              style={({ pressed }) => [styles.linkBtn, { borderColor: colors.tint, opacity: pressed ? 0.75 : 1 }]}>
              <Text style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>Open video link</Text>
            </Pressable>
          </View>
          {block.src.caption ? (
            <Text style={[styles.mediaCaption, { color: colors.text }]}>{block.src.caption}</Text>
          ) : null}
        </View>
      );
    }
    case 'audio':
      return <AudioCard block={block} colors={colors} />;
    case 'file':
      return (
        <Pressable
          onPress={() => openUrl(block.url)}
          style={({ pressed }) => [
            styles.fileCard,
            { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={2}>
            {block.name}
          </Text>
          <Text style={[styles.fileMeta, { color: colors.text }]}>
            {renderFileMeta(block.mimeType, block.sizeBytes)}
          </Text>
          {block.note ? (
            <Text style={[styles.fileNote, { color: colors.text }]} numberOfLines={2}>
              {block.note}
            </Text>
          ) : null}
          <Text style={{ color: colors.tint, fontSize: 13, fontWeight: '600', marginTop: 6 }}>Open file</Text>
        </Pressable>
      );
    case 'gallery':
      return (
        <View style={styles.galleryWrap}>
          {block.title ? (
            <Text style={[styles.galleryTitle, { color: colors.text }]}>{block.title}</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
            {block.items.map((item, idx) => (
              <Pressable
                key={`${item.src.url}-${idx}`}
                onPress={() => openUrl(item.src.url)}
                style={[styles.galleryItem, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Image source={{ uri: item.src.url }} style={styles.galleryImage} resizeMode="cover" />
                {item.alt || item.src.caption ? (
                  <Text style={[styles.galleryCaption, { color: colors.text }]} numberOfLines={2}>
                    {item.alt ?? item.src.caption}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      );
    case 'linkPreview':
      return (
        <Pressable
          onPress={() => openUrl(block.url)}
          style={({ pressed }) => [
            styles.linkCard,
            { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 },
          ]}>
          {block.imageUrl ? (
            <Image source={{ uri: block.imageUrl }} style={styles.linkImage} resizeMode="cover" />
          ) : null}
          <View style={styles.linkBody}>
            <Text style={[styles.linkTitle, { color: colors.text }]} numberOfLines={2}>
              {block.title ?? block.url}
            </Text>
            {block.description ? (
              <Text style={[styles.linkDesc, { color: colors.text }]} numberOfLines={3}>
                {block.description}
              </Text>
            ) : null}
            <Text style={[styles.linkHost, { color: colors.text }]} numberOfLines={1}>
              {block.siteName ?? getHost(block.url)}
            </Text>
          </View>
        </Pressable>
      );
    default:
      return null;
  }
}

function AudioCard({
  block,
  colors,
}: {
  block: Extract<McpUiBlock, { type: 'audio' }>;
  colors: Colors;
}) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync().catch(() => {});
      }
    };
  }, [sound]);

  const toggle = async () => {
    try {
      if (!sound) {
        setIsLoading(true);
        const created = new Audio.Sound();
        await created.loadAsync({ uri: block.src.url }, { shouldPlay: true });
        created.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          setIsPlaying(status.isPlaying);
        });
        setSound(created);
        setIsPlaying(true);
        return;
      }
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch {
      Alert.alert('Playback error', 'Could not play this audio clip.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.audioCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.audioTitle, { color: colors.text }]} numberOfLines={2}>
          {block.title ?? block.src.caption ?? 'Audio clip'}
        </Text>
        {block.artist ? (
          <Text style={[styles.audioArtist, { color: colors.text }]} numberOfLines={1}>
            {block.artist}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.audioBtn, { borderColor: colors.tint, opacity: pressed ? 0.75 : 1 }]}>
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.tint} />
        ) : (
          <Text style={{ color: colors.tint, fontWeight: '700' }}>{isPlaying ? 'Pause' : 'Play'}</Text>
        )}
      </Pressable>
      <Pressable onPress={() => openUrl(block.src.url)} style={styles.audioLinkWrap}>
        <Text style={{ color: colors.tint, fontSize: 12 }}>Open</Text>
      </Pressable>
    </View>
  );
}

function computeAspectRatio(w?: number, h?: number): number {
  if (!w || !h || w <= 0 || h <= 0) return 16 / 9;
  const ratio = w / h;
  if (ratio < 0.5) return 0.5;
  if (ratio > 2) return 2;
  return ratio;
}

function bytesToSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

function renderFileMeta(mimeType?: string, sizeBytes?: number): string {
  const parts = [mimeType, bytesToSize(sizeBytes)].filter(Boolean);
  return parts.length ? parts.join(' • ') : 'Document';
}

function getHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

async function openUrl(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url).catch(() => {
    Alert.alert('Could not open link', url);
  });
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginVertical: 6 },
  invalid: { padding: 8, borderRadius: 8, borderWidth: 1, marginVertical: 4 },
  notice: { padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  noticeTitle: { fontWeight: '700', marginBottom: 4, fontSize: 15 },
  noticeBody: { fontSize: 15, lineHeight: 21 },
  kvCard: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  kvRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 12, gap: 8 },
  kvK: { fontWeight: '600', width: '36%', fontSize: 14 },
  kvV: { flex: 1, fontSize: 14, lineHeight: 20 },
  list: { marginVertical: 4 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bullet: { fontSize: 16, lineHeight: 22, width: 14 },
  listText: { flex: 1, fontSize: 15, lineHeight: 22 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  mediaCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  image: { width: '100%', minHeight: 140, backgroundColor: 'rgba(0,0,0,0.08)' },
  video: { width: '100%', backgroundColor: '#000' },
  mediaCaption: { fontSize: 12, opacity: 0.8, padding: 10, paddingTop: 8 },
  mediaRow: { paddingHorizontal: 10, paddingTop: 8 },
  linkBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  audioCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  audioTitle: { fontSize: 14, fontWeight: '600' },
  audioArtist: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  audioBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    width: 72,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioLinkWrap: { paddingHorizontal: 4 },
  fileCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  fileName: { fontSize: 15, fontWeight: '600' },
  fileMeta: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  fileNote: { fontSize: 13, marginTop: 6, opacity: 0.85 },
  galleryWrap: { gap: 8 },
  galleryTitle: { fontSize: 14, fontWeight: '700' },
  galleryRow: { gap: 10, paddingRight: 8 },
  galleryItem: {
    width: 180,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  galleryImage: { width: '100%', height: 120, backgroundColor: 'rgba(0,0,0,0.08)' },
  galleryCaption: { fontSize: 12, padding: 8, lineHeight: 17 },
  linkCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  linkImage: { width: '100%', height: 140, backgroundColor: 'rgba(0,0,0,0.08)' },
  linkBody: { padding: 10 },
  linkTitle: { fontSize: 15, fontWeight: '700' },
  linkDesc: { fontSize: 13, opacity: 0.85, marginTop: 4, lineHeight: 18 },
  linkHost: { fontSize: 12, opacity: 0.6, marginTop: 8 },
});
