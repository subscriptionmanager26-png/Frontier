import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow, shellScreenSubtitle } from '@/constants/appShell';
import { getA2aBaseUrl, getA2aToken } from '@/lib/appSettings';
import { getAgentNameFromCard } from '@/lib/a2a/agentCard';
import { discoverAgent, normalizeAgentBaseUrl } from '@/lib/a2a/resolveAgentUrl';
import { listA2aDirectAgents, touchDirectAgentRecent, type A2aDirectAgent } from '@/lib/a2a/store';
import {
  fetchDiscoverableDisplayNamesForRpcUrls,
  searchDiscoverableAgentsFromCloud,
  type DiscoverableSearchHit,
} from '@/lib/discoverableAgentsCloudStore';
import { hasSupabaseConfig } from '@/lib/supabase';
import { logUxFlow } from '@/lib/uxFlowLog';

type DiscoverUi =
  | { kind: 'idle' }
  | { kind: 'loading'; url: string }
  | { kind: 'found'; url: string; name: string }
  | { kind: 'unreachable'; url: string; message: string };

function mergeAgents(saved: A2aDirectAgent[], settingsBaseUrl: string): A2aDirectAgent[] {
  const normSettings = settingsBaseUrl.trim() ? normalizeAgentBaseUrl(settingsBaseUrl) : null;
  const isSluglessGateway = (u: string) =>
    /\/functions\/v1\/a2a-gateway\/?$/i.test(u.trim()) || /\/a2a\/v1\/?$/i.test(u.trim());
  const savedSet = new Set(
    saved
      .map((s) => normalizeAgentBaseUrl(s.agentUrl) || s.agentUrl.replace(/\/+$/, ''))
      .filter((u) => !isSluglessGateway(u))
  );
  const out: A2aDirectAgent[] = [];
  if (normSettings && !isSluglessGateway(normSettings) && !savedSet.has(normSettings)) {
    out.push({
      agentUrl: normSettings,
      lastUpdatedAt: 0,
      sessionCount: 0,
    });
  }
  out.push(...saved.filter((r) => !isSluglessGateway(r.agentUrl)));
  return out;
}

function comparableAgentUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase();
}

/** Directory is slug/name search; skip only when the user pasted a full http(s) URL (bare hostnames still run directory). */
function isExplicitHttpAgentUrlInput(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

export default function SearchTabScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [savedAgents, setSavedAgents] = useState<A2aDirectAgent[]>([]);
  const [settingsUrl, setSettingsUrl] = useState('');
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [discover, setDiscover] = useState<DiscoverUi>({ kind: 'idle' });
  const [directoryHits, setDirectoryHits] = useState<DiscoverableSearchHit[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directorySearchError, setDirectorySearchError] = useState<string | null>(null);
  /** Avoid refetching agent card names on every tab focus when URLs unchanged. */
  const agentNameCacheRef = useRef<Record<string, string>>({});

  const loadAgents = useCallback(async () => {
    const rows = await listA2aDirectAgents();
    setSavedAgents(rows);
    const token = await getA2aToken();
    const def = await getA2aBaseUrl();
    setSettingsUrl(def.trim());

    const urls = new Set<string>();
    const norm = def.trim() ? normalizeAgentBaseUrl(def.trim()) : null;
    if (norm) urls.add(norm);
    rows.forEach((r) => urls.add(r.agentUrl));

    const cache = agentNameCacheRef.current;
    const directoryNames = await fetchDiscoverableDisplayNamesForRpcUrls([...urls]);
    const pairs = await Promise.all(
      [...urls].map(async (u) => {
        const hit = cache[u];
        if (hit && hit !== 'Unknown Agent') return [u, hit] as const;
        const name = await getAgentNameFromCard(u, token, { directoryNames });
        cache[u] = name;
        return [u, name] as const;
      })
    );
    setAgentNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAgents();
    } finally {
      setRefreshing(false);
    }
  }, [loadAgents]);

  useFocusEffect(
    useCallback(() => {
      void loadAgents();
    }, [loadAgents])
  );

  useEffect(() => {
    const parsed = normalizeAgentBaseUrl(query);
    if (!parsed) {
      setDiscover({ kind: 'idle' });
      return;
    }

    setDiscover({ kind: 'loading', url: parsed });
    let cancelled = false;
    const t = setTimeout(async () => {
      const token = await getA2aToken();
      const res = await discoverAgent(query.trim(), token);
      if (cancelled) return;
      if (res.ok && res.kind === 'found') {
        setDiscover({ kind: 'found', url: res.baseUrl, name: res.displayName });
        setAgentNames((prev) => ({ ...prev, [res.baseUrl]: res.displayName }));
      } else if (!res.ok && res.kind === 'unreachable') {
        setDiscover({ kind: 'unreachable', url: res.baseUrl, message: res.message });
      } else {
        setDiscover({ kind: 'idle' });
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const raw = query.trim();
    const skipForExplicitHttp = isExplicitHttpAgentUrlInput(raw);
    if (!hasSupabaseConfig || raw.length < 2 || skipForExplicitHttp) {
      setDirectoryHits([]);
      setDirectorySearchError(null);
      setDirectoryLoading(false);
      return;
    }

    setDirectoryLoading(true);
    setDirectorySearchError(null);
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { hits, errorMessage } = await searchDiscoverableAgentsFromCloud(raw);
          if (!cancelled) {
            setDirectoryHits(hits);
            setDirectorySearchError(errorMessage ?? null);
          }
        } catch (e) {
          if (!cancelled) {
            setDirectoryHits([]);
            setDirectorySearchError(e instanceof Error ? e.message : String(e));
          }
        } finally {
          if (!cancelled) setDirectoryLoading(false);
        }
      })();
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const openAgent = (agentUrl: string, displayName?: string) => {
    void (async () => {
      await logUxFlow('ux.flow.search.open_agent_hub', {
        agentUrl,
        displayName: displayName?.trim() || null,
        step: 'Search → /direct/agent (start or resume hub with this agent)',
      });
      await touchDirectAgentRecent(agentUrl);
      router.push({
        pathname: '/direct/agent',
        params: displayName?.trim()
          ? { url: agentUrl, displayName: displayName.trim() }
          : { url: agentUrl },
      });
    })();
  };

  const merged = useMemo(
    () => mergeAgents(savedAgents, settingsUrl),
    [savedAgents, settingsUrl]
  );

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((r) => {
      const name = (agentNames[r.agentUrl] || '').toLowerCase();
      const url = r.agentUrl.toLowerCase();
      return name.includes(q) || url.includes(q);
    });
  }, [agentNames, merged, query]);

  const discoverMatchesSaved =
    discover.kind === 'found' &&
    merged.some((a) => {
      const na = normalizeAgentBaseUrl(a.agentUrl) || a.agentUrl.replace(/\/+$/, '');
      const nd = discover.url.replace(/\/+$/, '');
      return na === nd;
    });

  const savedUrlKeys = useMemo(
    () => new Set(merged.map((a) => comparableAgentUrl(a.agentUrl))),
    [merged]
  );

  const listHeader = (
    <View style={styles.headerBlock}>
      <Text style={[shellScreenSubtitle(colors.mutedText), { marginBottom: 16 }]}>
        Search the public directory by name or slug, filter your saved agents, or paste an agent URL (https://…).
      </Text>
      <View
        style={[
          styles.searchWrap,
          {
            backgroundColor: colors.card,
            borderColor: shell.borderSubtle,
          },
          shellCardShadow(isDark),
        ]}>
        <FontAwesome name="search" size={17} color={colors.mutedText} style={styles.searchIcon} />
        <TextInput
          style={[
            styles.searchInput,
            {
              color: colors.text,
              backgroundColor: shell.elevatedMuted,
            },
          ]}
          placeholder="Name, slug, hostname, or full URL"
          placeholderTextColor={colors.mutedText}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {discover.kind === 'loading' ? (
        <View style={[styles.discoverCard, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
          <ActivityIndicator color={colors.tint} />
          <Text style={[styles.discoverMeta, { color: colors.mutedText }]}>Checking agent…</Text>
          <Text style={[styles.discoverUrl, { color: colors.text }]} numberOfLines={2}>
            {discover.url}
          </Text>
        </View>
      ) : null}

      {discover.kind === 'found' && !discoverMatchesSaved ? (
        <Pressable
          onPress={() => openAgent(discover.url, discover.name)}
          style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
          <View style={[styles.discoverCard, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
            <View style={styles.discoverRow}>
              <Text style={[styles.discoverTitle, { color: colors.text }]} numberOfLines={2}>
                {discover.name}
              </Text>
              <FontAwesome name="comment" size={20} color={colors.tint} />
            </View>
            <Text style={[styles.discoverUrl, { color: colors.mutedText }]} numberOfLines={2}>
              {discover.url}
            </Text>
            <Text style={[styles.tapHint, { color: colors.tint }]}>Tap to message</Text>
          </View>
        </Pressable>
      ) : null}

      {discover.kind === 'found' && discoverMatchesSaved ? (
        <View style={[styles.discoverHint, { backgroundColor: shell.elevatedMuted }]}>
          <Text style={[styles.discoverMeta, { color: colors.mutedText }]}>
            Agent verified — also listed below.
          </Text>
        </View>
      ) : null}

      {discover.kind === 'unreachable' ? (
        <View style={[styles.discoverCard, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
          <Text style={[styles.discoverTitle, { color: colors.text }]}>Could not verify agent</Text>
          <Text style={[styles.discoverUrl, { color: colors.mutedText }]} numberOfLines={3}>
            {discover.message}
          </Text>
          <Text style={[styles.discoverUrl, { color: colors.text, marginTop: 8 }]} numberOfLines={2}>
            {discover.url}
          </Text>
          <Pressable
            onPress={() => openAgent(discover.url)}
            style={[styles.secondaryCta, { borderColor: colors.tint }]}>
            <Text style={{ color: colors.tint, fontWeight: '600' }}>Open chat anyway</Text>
          </Pressable>
        </View>
      ) : null}

      {hasSupabaseConfig && query.trim().length >= 2 && !isExplicitHttpAgentUrlInput(query.trim()) ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>Directory</Text>
          {directoryLoading ? (
            <View style={[styles.discoverCard, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
              <ActivityIndicator color={colors.tint} />
              <Text style={[styles.discoverMeta, { color: colors.mutedText }]}>Searching directory…</Text>
            </View>
          ) : (
            <>
              {directorySearchError ? (
                <Text
                  style={[
                    styles.directoryEmpty,
                    { color: directoryHits.length > 0 ? colors.mutedText : colors.negative },
                  ]}>
                  {directoryHits.length > 0
                    ? `Some directory queries failed (showing partial results): ${directorySearchError}`
                    : `Directory search failed: ${directorySearchError}`}
                </Text>
              ) : null}
              {!directorySearchError && directoryHits.length === 0 ? (
                <Text style={[styles.directoryEmpty, { color: colors.mutedText }]}>
                  No directory matches. Ensure agents have synced with a public slug and A2A base URL; or try a full
                  agent URL.
                </Text>
              ) : null}
              {directoryHits.map((hit) => {
                const alreadySaved =
                  savedUrlKeys.has(comparableAgentUrl(hit.agentBaseUrl)) ||
                  savedUrlKeys.has(comparableAgentUrl(hit.rpcUrl));
                return (
                  <Pressable
                    key={`${hit.userAgentId}:${hit.slug}`}
                    onPress={() => openAgent(hit.rpcUrl, hit.displayName)}
                    style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
                    <View style={[styles.card, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
                      <View style={styles.cardTop}>
                        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                          {hit.displayName}
                        </Text>
                        <FontAwesome name="comment" size={17} color={colors.tint} />
                      </View>
                      <Text style={[styles.sub, { color: colors.mutedText }]} numberOfLines={1}>
                        @{hit.slug}
                      </Text>
                      <Text style={[styles.sub, { color: colors.mutedText }]} numberOfLines={2}>
                        {hit.rpcUrl}
                      </Text>
                      {alreadySaved ? (
                        <Text style={[styles.badge, { color: colors.tint }]}>
                          Already in “Your agents” below
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </>
          )}
        </>
      ) : null}

      <Text style={[styles.sectionLabel, { color: colors.mutedText, marginTop: 8 }]}>Your agents</Text>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.content}
      data={filteredAgents}
      keyExtractor={(i) => i.agentUrl}
      onRefresh={refresh}
      refreshing={refreshing}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.mutedText }]}>
          {merged.length === 0 && !query.trim()
            ? 'No agents yet. Paste an A2A agent URL above or set a default agent in Settings.'
            : 'No agents match this search. Try a full URL if you have one.'}
        </Text>
      }
      renderItem={({ item }) => {
        const isSettingsOnly = item.sessionCount === 0 && item.lastUpdatedAt === 0;
        return (
          <Pressable onPress={() => openAgent(item.agentUrl)} style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
            <View style={[styles.card, { backgroundColor: colors.card }, shellCardShadow(isDark)]}>
              <View style={styles.cardTop}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {agentNames[item.agentUrl] || 'Unknown Agent'}
                </Text>
                <FontAwesome name="comment" size={17} color={colors.tint} />
              </View>
              <Text style={[styles.sub, { color: colors.mutedText }]} numberOfLines={2}>
                {item.agentUrl}
              </Text>
              {isSettingsOnly ? (
                <Text style={[styles.badge, { color: colors.tint }]}>From Settings · not used yet</Text>
              ) : (
                <>
                  <Text style={[styles.sub, { color: colors.mutedText }]}>Sessions: {item.sessionCount}</Text>
                  <Text style={[styles.sub, { color: colors.mutedText }]}>
                    Last active: {new Date(item.lastUpdatedAt).toLocaleString()}
                  </Text>
                </>
              )}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  headerBlock: { marginBottom: 8 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  searchIcon: { marginRight: 0 },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    minHeight: 44,
  },
  discoverCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  discoverTitle: { fontSize: 17, fontWeight: '600', flex: 1, letterSpacing: -0.2 },
  discoverUrl: { fontSize: 13, lineHeight: 18 },
  discoverMeta: { fontSize: 14 },
  tapHint: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  discoverHint: { borderRadius: 12, padding: 12, marginBottom: 16 },
  secondaryCta: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  content: { padding: 20, paddingBottom: 40 },
  empty: { textAlign: 'center', marginTop: 16, lineHeight: 22, fontSize: 15 },
  card: { borderRadius: 16, padding: 18, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '600', flex: 1, marginRight: 8, letterSpacing: -0.2 },
  sub: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  badge: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  directoryEmpty: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
});
