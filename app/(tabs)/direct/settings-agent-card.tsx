import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import { fetchMyDiscoverableCardFromCloud } from '@/lib/discoverableAgentsCloudStore';
import { buildPublicAgentCard, getDiscoverabilityBaseUrl } from '@/lib/discoverability';
import { getA2aBaseUrl } from '@/lib/appSettings';
import { listUserAgents } from '@/lib/userAgents';

export default function SettingsAgentCardScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [loading, setLoading] = useState(true);
  const [localJson, setLocalJson] = useState<string>('');
  const [cloudJson, setCloudJson] = useState<string | null>(null);
  const [cloudMeta, setCloudMeta] = useState<{
    slug: string;
    displayName: string;
    updatedAt: string;
  } | null>(null);
  const [summary, setSummary] = useState<{ rpcUrl: string; cardUrl: string | null; slug: string; name: string } | null>(
    null
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const agents = await listUserAgents();
      const agent = agents[0] ?? null;
      const discoveryBase = getDiscoverabilityBaseUrl();
      const rpcBase = ((agent?.baseUrlOverride || (await getA2aBaseUrl())) || '').trim();

      if (!agent || !rpcBase) {
        setSummary(null);
        setLocalJson('');
      } else {
        const card = buildPublicAgentCard({
          agent,
          discoveryBaseUrl: discoveryBase,
          rpcBaseUrl: rpcBase,
        });
        const baseTrim = discoveryBase.replace(/\/+$/, '');
        const cardUrl =
          baseTrim && agent.publicSlug
            ? `${baseTrim}/.well-known/frontier-agents/${agent.publicSlug}/agent-card.json`
            : null;
        setSummary({
          name: agent.name,
          slug: agent.publicSlug || '',
          rpcUrl: card.url,
          cardUrl,
        });
        setLocalJson(JSON.stringify(card, null, 2));
      }

      const cloud = await fetchMyDiscoverableCardFromCloud();
      if (cloud?.cardJson !== undefined && cloud.cardJson !== null) {
        setCloudJson(JSON.stringify(cloud.cardJson, null, 2));
        setCloudMeta({
          slug: cloud.slug,
          displayName: cloud.displayName,
          updatedAt: cloud.updatedAt,
        });
      } else {
        setCloudJson(null);
        setCloudMeta(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const copyLocal = async () => {
    if (!localJson) return;
    await Clipboard.setStringAsync(localJson);
    Alert.alert('Copied', 'Local agent card JSON copied.');
  };

  const copyCloud = async () => {
    if (!cloudJson) return;
    await Clipboard.setStringAsync(cloudJson);
    Alert.alert('Copied', 'Cloud-stored card JSON copied.');
  };

  const indexSnippet = useMemo(() => {
    if (!summary?.slug) return null;
    const base = getDiscoverabilityBaseUrl().replace(/\/+$/, '');
    if (!base) return null;
    return JSON.stringify(
      {
        version: 1,
        hint: 'Your entry appears in the public index after sync.',
        cardUrl: `${base}/.well-known/frontier-agents/${summary.slug}/agent-card.json`,
      },
      null,
      2
    );
  }, [summary?.slug]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: shell.canvas }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.help, { color: colors.text }]}>
        Your A2A agent card describes how other agents reach you (JSON-RPC URL, name, slug). The local preview uses your
        user agent and primary A2A base URL. If you are signed in and synced, the cloud copy reflects what was last
        written to the directory.
      </Text>

      {!summary ? (
        <View
          style={[
            styles.card,
            { borderColor: shell.borderSubtle, backgroundColor: colors.card },
            shellCardShadow(isDark),
          ]}>
          <Text style={{ color: colors.text }}>
            Add a primary agent URL under Agents and ensure your user agent exists to preview a card.
          </Text>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.card,
              { borderColor: shell.borderSubtle, backgroundColor: colors.card },
              shellCardShadow(isDark),
            ]}>
            <Text style={[styles.k, { color: colors.mutedText }]}>Name</Text>
            <Text style={[styles.v, { color: colors.text }]}>{summary.name}</Text>
            <Text style={[styles.k, { color: colors.mutedText }]}>Username (public slug)</Text>
            <Text style={[styles.v, { color: colors.text }]}>{summary.slug || '(not set)'}</Text>
            <Text style={[styles.k, { color: colors.mutedText }]}>A2A JSON-RPC URL</Text>
            <Text style={[styles.v, { color: colors.text }]} selectable>
              {summary.rpcUrl}
            </Text>
            {summary.cardUrl ? (
              <>
                <Text style={[styles.k, { color: colors.mutedText }]}>Public card URL (when discovery base is set)</Text>
                <Text style={[styles.v, { color: colors.text }]} selectable>
                  {summary.cardUrl}
                </Text>
              </>
            ) : (
              <Text style={[styles.muted, { color: colors.text, marginTop: 8 }]}>
                Set EXPO_PUBLIC_DISCOVERY_BASE_URL to show a hosted card URL in previews.
              </Text>
            )}
          </View>

          {!summary.slug ? (
            <Text style={[styles.warn, { color: colors.text }]}>
              Set a public slug on your user agent for stable discovery URLs.
            </Text>
          ) : null}
        </>
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Local preview (computed)</Text>
      <Pressable
        onPress={() => void copyLocal()}
        disabled={!localJson}
        style={[styles.copyBtn, { borderColor: colors.tint, opacity: localJson ? 1 : 0.45 }]}>
        <Text style={{ color: colors.tint, fontWeight: '600' }}>Copy JSON</Text>
      </Pressable>
      <View
        style={[
          styles.jsonCard,
          { borderColor: colors.tabIconDefault, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <Text style={[styles.json, { color: colors.text }]} selectable>
          {localJson || '—'}
        </Text>
      </View>

      {indexSnippet ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Index URL hint</Text>
          <View
            style={[
              styles.jsonCard,
              { borderColor: colors.tabIconDefault, backgroundColor: colors.card },
              shellCardShadow(isDark),
            ]}>
            <Text style={[styles.json, { color: colors.text }]} selectable>
              {indexSnippet}
            </Text>
          </View>
        </>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Cloud (last synced)</Text>
      {!cloudJson ? (
        <Text style={[styles.muted, { color: colors.text }]}>
          No row in Supabase yet, or you are not signed in. Open the app while online to sync discoverability.
        </Text>
      ) : (
        <>
          {cloudMeta ? (
            <View
              style={[
                styles.card,
                { borderColor: shell.borderSubtle, backgroundColor: colors.card },
                shellCardShadow(isDark),
                { marginBottom: 12 },
              ]}>
              <Text style={[styles.k, { color: colors.mutedText }]}>Directory name</Text>
              <Text style={[styles.v, { color: colors.text }]}>{cloudMeta.displayName}</Text>
              <Text style={[styles.k, { color: colors.mutedText }]}>Slug</Text>
              <Text style={[styles.v, { color: colors.text }]}>{cloudMeta.slug}</Text>
              <Text style={[styles.k, { color: colors.mutedText }]}>Public directory</Text>
              <Text style={[styles.v, { color: colors.text }]}>Listed (remove your user agent to delist)</Text>
              <Text style={[styles.k, { color: colors.mutedText }]}>Updated</Text>
              <Text style={[styles.v, { color: colors.text }]}>{cloudMeta.updatedAt}</Text>
            </View>
          ) : null}
          <Pressable onPress={() => void copyCloud()} style={[styles.copyBtn, { borderColor: colors.tint }]}>
            <Text style={{ color: colors.tint, fontWeight: '600' }}>Copy cloud JSON</Text>
          </Pressable>
          <View
            style={[
              styles.jsonCard,
              { borderColor: colors.tabIconDefault, backgroundColor: colors.card },
              shellCardShadow(isDark),
            ]}>
            <Text style={[styles.json, { color: colors.text }]} selectable>
              {cloudJson}
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 22, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  help: { fontSize: 14, opacity: 0.75, lineHeight: 20, marginBottom: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 4,
  },
  k: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  v: { fontSize: 15, lineHeight: 22 },
  muted: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  warn: { fontSize: 14, opacity: 0.85, marginBottom: 12, lineHeight: 20 },
  copyBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  jsonCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  json: { fontSize: 11, lineHeight: 16, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
