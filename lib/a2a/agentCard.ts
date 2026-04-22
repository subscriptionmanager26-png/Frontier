import AsyncStorage from '@react-native-async-storage/async-storage';

import { canonicalA2aAgentUrl } from '@/lib/a2a/canonicalAgentUrl';
import { fetchDiscoverableDisplayNamesForRpcUrls } from '@/lib/discoverableAgentsCloudStore';
import { gatewayRootForAgentDiscovery } from '@/lib/a2a/gatewayUrl';

const NAME_CACHE: Record<string, string> = {};
const HINT_STORAGE_KEY = 'frontier_agent_display_name_hints_v1';

type AgentCardLike = {
  name?: string;
  agent?: { name?: string };
};

async function fetchJson(url: string, token?: string | null): Promise<AgentCardLike> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'ngrok-skip-browser-warning': '1',
  };
  if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AgentCardLike;
}

async function loadHintMap(): Promise<Record<string, string>> {
  try {
    const r = await AsyncStorage.getItem(HINT_STORAGE_KEY);
    if (!r) return {};
    const p = JSON.parse(r) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function persistHint(canon: string, name: string): Promise<void> {
  try {
    const m = await loadHintMap();
    m[canon] = name;
    await AsyncStorage.setItem(HINT_STORAGE_KEY, JSON.stringify(m));
  } catch {
    // ignore
  }
}

async function rememberedDisplayName(canon: string): Promise<string | null> {
  const m = await loadHintMap();
  const n = m[canon]?.trim();
  return n || null;
}

export type AgentNameOptions = {
  /** From Search / directory row — overrides shared gateway `/.well-known` (same card for all slugs). */
  hint?: string | null;
  /** From `fetchDiscoverableDisplayNamesForRpcUrls` for list screens. */
  directoryNames?: Record<string, string>;
};

/**
 * Human-readable agent title: directory `display_name` (per slug) when available, else `/.well-known` on the gateway root.
 * Caches by **canonical RPC URL** so multiple slugs on one gateway do not share one name.
 */
export async function getAgentNameFromCard(
  baseUrl: string,
  token?: string | null,
  options?: AgentNameOptions
): Promise<string> {
  const canon = canonicalA2aAgentUrl(baseUrl);
  if (!canon) return 'Unknown Agent';

  const hint = options?.hint?.trim();
  if (hint) {
    NAME_CACHE[canon] = hint;
    void persistHint(canon, hint);
    return hint;
  }

  const fromBatch = options?.directoryNames?.[canon]?.trim();
  if (fromBatch) {
    NAME_CACHE[canon] = fromBatch;
    void persistHint(canon, fromBatch);
    return fromBatch;
  }

  if (NAME_CACHE[canon]) return NAME_CACHE[canon]!;

  const remembered = await rememberedDisplayName(canon);
  if (remembered) {
    NAME_CACHE[canon] = remembered;
    return remembered;
  }

  const fromCloud = await fetchDiscoverableDisplayNamesForRpcUrls([canon]);
  if (fromCloud[canon]?.trim()) {
    const n = fromCloud[canon].trim();
    NAME_CACHE[canon] = n;
    void persistHint(canon, n);
    return n;
  }

  const gw = gatewayRootForAgentDiscovery(canon);
  if (!gw) return 'Unknown Agent';
  try {
    const primary = await fetchJson(`${gw}/.well-known/agent-card.json`, token).catch(async () =>
      fetchJson(`${gw}/.well-known/agent.json`, token)
    );
    const name = (primary.name || primary.agent?.name || '').trim();
    const resolved = name || 'Unknown Agent';
    NAME_CACHE[canon] = resolved;
    return resolved;
  } catch {
    return 'Unknown Agent';
  }
}

/** Full agent card JSON from `.well-known/agent-card.json` or `agent.json` (for UI / debugging). */
export async function fetchAgentCardDocument(baseUrl: string, token?: string | null): Promise<unknown | null> {
  const base = gatewayRootForAgentDiscovery(baseUrl);
  if (!base) return null;
  try {
    return await fetchJson(`${base}/.well-known/agent-card.json`, token).catch(async () =>
      fetchJson(`${base}/.well-known/agent.json`, token)
    );
  } catch {
    return null;
  }
}
