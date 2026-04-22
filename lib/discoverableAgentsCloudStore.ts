import { canonicalA2aAgentUrl } from '@/lib/a2a/canonicalAgentUrl';
import { gatewayRootForAgentDiscovery } from '@/lib/a2a/gatewayUrl';
import { supabase } from '@/lib/supabase';
import {
  buildPublicAgentCard,
  buildPublicAgentsIndex,
  getDiscoverabilityBaseUrl,
} from '@/lib/discoverability';
import { getA2aBaseUrl } from '@/lib/appSettings';
import { listUserAgents, type UserAgent } from '@/lib/userAgents';

type DiscoverableRow = {
  user_id: string;
  user_agent_id: string;
  slug: string;
  display_name: string;
  card_json: unknown;
  enabled: boolean;
  updated_at: string;
};

export type DiscoverableSearchHit = {
  userAgentId: string;
  displayName: string;
  slug: string;
  /** JSON-RPC endpoint from the stored card (`url`). */
  rpcUrl: string;
  /** Gateway root for `openAgent` / `.well-known` (RPC path stripped when applicable). */
  agentBaseUrl: string;
};

/** Result of `searchDiscoverableAgentsFromCloud` — includes PostgREST errors so the UI is not silent on failure. */
export type DiscoverableCloudSearchOutcome = {
  hits: DiscoverableSearchHit[];
  /** Present when Supabase returned an error or the client is missing (otherwise empty results look like “no matches”). */
  errorMessage?: string;
};

const TABLE = 'discoverable_user_agents';

/** True when upsert failed because another row already uses this slug (global unique index). */
function isGlobalSlugUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  const m = (err.message || '').toLowerCase();
  return (
    m.includes('duplicate key') ||
    m.includes('unique constraint') ||
    m.includes('discoverable_user_agents_slug_lower_unique')
  );
}

/** Latest discoverable row for the signed-in user (primary user agent), if any. */
export async function fetchMyDiscoverableCardFromCloud(): Promise<{
  cardJson: unknown;
  slug: string;
  /** Stable id — reuse after local wipe so upsert matches PK and slug is not duplicated. */
  userAgentId: string;
  displayName: string;
  enabled: boolean;
  updatedAt: string;
} | null> {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('card_json,slug,user_agent_id,display_name,enabled,updated_at')
    .eq('user_id', session.user.id)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || !data[0]) return null;
  const r = data[0] as Record<string, unknown>;
  return {
    cardJson: r.card_json,
    slug: String(r.slug ?? ''),
    userAgentId: String(r.user_agent_id ?? ''),
    displayName: String(r.display_name ?? ''),
    enabled: !!r.enabled,
    updatedAt: String(r.updated_at ?? ''),
  };
}

function parseCardJson(card: unknown): Record<string, unknown> | null {
  if (!card) return null;
  if (typeof card === 'object' && card !== null && !Array.isArray(card)) {
    return card as Record<string, unknown>;
  }
  if (typeof card === 'string') {
    try {
      const p = JSON.parse(card) as unknown;
      if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** JSON-RPC URL from stored agent card (same shape as `buildPublicAgentCard`). */
function rpcUrlFromStoredCard(card: unknown): string | null {
  const o = parseCardJson(card);
  if (!o) return null;
  const direct = typeof o.url === 'string' ? o.url.trim() : '';
  if (direct) return direct.replace(/\/+$/, '');
  const si = o.supportedInterfaces;
  if (Array.isArray(si)) {
    for (const item of si) {
      if (item && typeof item === 'object') {
        const u = (item as Record<string, unknown>).url;
        if (typeof u === 'string' && u.trim()) return u.trim().replace(/\/+$/, '');
      }
    }
  }
  return null;
}

/**
 * Frontier's direct hub loads `/.well-known/agent-card.json` off the **gateway base** (Edge Function root),
 * not off the JSON-RPC path. Strip `/a2a/v1/:slug` when present.
 */
export function agentBaseUrlFromRpcUrl(rpcUrl: string): string {
  return gatewayRootForAgentDiscovery(rpcUrl);
}

/** Last path segment of `.../a2a/v1/:slug` — matches directory `slug` for display names. */
export function slugFromA2aRpcUrl(rpcUrl: string): string | null {
  const t = rpcUrl.trim().replace(/\/+$/, '');
  const m = t.match(/\/a2a\/v1\/([^/?#]+)\/?$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

/**
 * Maps canonical RPC URLs → `discoverable_user_agents.display_name` using the slug in the path.
 * Shared gateways serve one `/.well-known/agent-card.json` for all slugs; this is the correct per-peer label.
 */
export async function fetchDiscoverableDisplayNamesForRpcUrls(
  rpcUrls: string[]
): Promise<Record<string, string>> {
  const slugToCanons = new Map<string, string[]>();
  const slugLookupKeys = new Set<string>();
  for (const raw of rpcUrls) {
    const canon = canonicalA2aAgentUrl(raw);
    if (!canon) continue;
    const slug = slugFromA2aRpcUrl(canon);
    if (!slug?.trim()) continue;
    const key = slug.trim().toLowerCase();
    const list = slugToCanons.get(key) ?? [];
    list.push(canon);
    slugToCanons.set(key, list);
    slugLookupKeys.add(slug.trim());
    slugLookupKeys.add(key);
  }
  if (slugToCanons.size === 0 || !supabase) return {};

  const uniqueSlugs = [...slugLookupKeys];
  const { data, error } = await supabase
    .from(TABLE)
    .select('slug,display_name')
    .eq('enabled', true)
    .in('slug', uniqueSlugs);

  if (error || !Array.isArray(data)) return {};

  const bySlugLower = new Map<string, string>();
  for (const row of data as { slug?: string; display_name?: string }[]) {
    const s = String(row.slug ?? '')
      .trim()
      .toLowerCase();
    const dn = String(row.display_name ?? '').trim();
    if (s && dn) bySlugLower.set(s, dn);
  }

  const out: Record<string, string> = {};
  for (const [slugLower, canons] of slugToCanons) {
    const name = bySlugLower.get(slugLower);
    if (!name) continue;
    for (const c of canons) {
      out[c] = name;
    }
  }
  return out;
}

/**
 * ILIKE pattern: `%q%`. User `%` / `_` act as SQL wildcards (acceptable for self-service search).
 * Avoid embedding `,` in .or() by using two separate queries instead.
 */
function ilikeContainsPattern(q: string): string {
  return `%${q}%`;
}

/**
 * Search discoverable agents (Supabase). Matches display name or slug (substring, case-insensitive).
 * Rows are public-directory entries (`enabled = true`); legacy `enabled = false` rows are backfilled by migration.
 *
 * Uses two queries (slug + display_name) to avoid comma/escaping issues in a single `.or()` filter.
 *
 * Note: `%` and `_` in the query are ILIKE wildcards (substring search is `%query%`). Do not pre-strip
 * the string or a two-character search can become empty and return no rows.
 *
 * Own profile may appear in results; the Search UI can label it. Account isolation is enforced by
 * auth + local storage clears, not by hiding your row here (which made “only me in the directory” look like a broken search).
 */
export async function searchDiscoverableAgentsFromCloud(query: string): Promise<DiscoverableCloudSearchOutcome> {
  const q = query.trim();
  if (q.length < 2) {
    return { hits: [] };
  }
  if (!supabase) {
    return {
      hits: [],
      errorMessage: 'Supabase is not configured (missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY).',
    };
  }

  const pattern = ilikeContainsPattern(q);
  const rpcBaseFallback = ((await getA2aBaseUrl()) || '').trim();

  const { data: bySlug, error: errSlug } = await supabase
    .from(TABLE)
    .select('user_agent_id,display_name,slug,card_json,enabled')
    .eq('enabled', true)
    .filter('slug', 'ilike', pattern)
    .limit(500);

  const { data: byName, error: errName } = await supabase
    .from(TABLE)
    .select('user_agent_id,display_name,slug,card_json,enabled')
    .eq('enabled', true)
    .filter('display_name', 'ilike', pattern)
    .limit(500);

  if (errSlug) {
    // eslint-disable-next-line no-console
    console.warn('[DISCOVERY] search by slug error', errSlug.message);
  }
  if (errName) {
    // eslint-disable-next-line no-console
    console.warn('[DISCOVERY] search by display_name error', errName.message);
  }

  const slugRows = !errSlug && Array.isArray(bySlug) ? bySlug : [];
  const nameRows = !errName && Array.isArray(byName) ? byName : [];
  const errParts: string[] = [];
  if (errSlug) errParts.push(errSlug.message);
  if (errName) errParts.push(errName.message);

  const raw = [...slugRows, ...nameRows];
  const seen = new Set<string>();
  const rows: typeof raw = [];
  for (const r of raw) {
    const id = r && typeof r === 'object' ? String((r as Record<string, unknown>).user_agent_id ?? '') : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push(r);
  }

  const hits: DiscoverableSearchHit[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const displayName = String(rec.display_name ?? '').trim();
    const slug = String(rec.slug ?? '').trim();
    if (!displayName || !slug) continue;
    let rpcUrl = rpcUrlFromStoredCard(rec.card_json);
    if (!rpcUrl && rpcBaseFallback) {
      rpcUrl = `${rpcBaseFallback.replace(/\/+$/, '')}/a2a/v1/${slug}`;
    }
    if (!rpcUrl) {
      // eslint-disable-next-line no-console
      console.warn('[DISCOVERY] search hit missing rpc url in card_json; slug=', slug);
      continue;
    }
    hits.push({
      userAgentId: String(rec.user_agent_id || ''),
      displayName: displayName || 'Agent',
      slug,
      rpcUrl,
      agentBaseUrl: agentBaseUrlFromRpcUrl(rpcUrl),
    });
  }

  const errorMessage =
    errParts.length > 0 ? errParts.join(' · ') : undefined;

  // #region agent log
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '583810' },
      body: JSON.stringify({
        sessionId: '583810',
        location: 'discoverableAgentsCloudStore.ts:searchDiscoverableAgentsFromCloud',
        message: 'directory search outcome',
        data: {
          hypothesisId: 'DISC',
          qLen: q.length,
          slugRowCount: slugRows.length,
          nameRowCount: nameRows.length,
          mergedUnique: rows.length,
          hitCount: hits.length,
          errSlug: errSlug?.message ?? null,
          errName: errName?.message ?? null,
          hasRpcFallback: !!rpcBaseFallback,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  return { hits, errorMessage };
}

export async function pushDiscoverableAgentsToCloud(): Promise<void> {
  if (!supabase) {
    // eslint-disable-next-line no-console
    console.log('[DISCOVERY] no supabase client');
    return;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    // eslint-disable-next-line no-console
    console.log('[DISCOVERY] no active session');
    return;
  }
  const userId = session.user.id;
  const client = supabase;
  const discoveryBase = getDiscoverabilityBaseUrl();
  const rpcBase = ((await getA2aBaseUrl()) || '').trim();
  if (!rpcBase) {
    // eslint-disable-next-line no-console
    console.log('[DISCOVERY] missing rpc base url');
    return;
  }

  /**
   * After sign-out, local storage is wiped and `ensurePrimaryUserAgent` may assign a new `user_agent_id`.
   * The old discoverable row still holds the same slug → INSERT upsert conflicts on global slug.
   * Delete orphan rows for this user so the new (user_id, user_agent_id, slug) can insert.
   */
  async function deleteStaleDiscoverableRowsForUser(currentAgentId: string): Promise<void> {
    const { data: existing, error: selErr } = await client
      .from(TABLE)
      .select('user_agent_id')
      .eq('user_id', userId);
    if (selErr || !existing?.length) return;
    for (const row of existing) {
      const aid = String(row.user_agent_id ?? '');
      if (aid && aid !== currentAgentId) {
        const { error: delErr } = await client
          .from(TABLE)
          .delete()
          .eq('user_id', userId)
          .eq('user_agent_id', aid);
        if (delErr) {
          // eslint-disable-next-line no-console
          console.log('[DISCOVERY] delete stale discoverable row failed', delErr.message);
        }
      }
    }
  }

  const agentsNow = await listUserAgents();
  const agentsWithSlug = agentsNow.filter((a) => a.publicSlug);
  const primaryId = agentsWithSlug[0]?.id;
  if (primaryId) {
    await deleteStaleDiscoverableRowsForUser(primaryId);
  }
  const rows: DiscoverableRow[] = agentsWithSlug.map((a) => ({
    user_id: userId,
    user_agent_id: a.id,
    slug: a.publicSlug!,
    display_name: a.name,
    card_json: buildPublicAgentCard({
      agent: a,
      discoveryBaseUrl: discoveryBase,
      rpcBaseUrl: rpcBase,
    }),
    enabled: true,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length === 0) {
    return;
  }

  const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'user_id,user_agent_id' });
  if (error) {
    // eslint-disable-next-line no-console
    console.log('[DISCOVERY] supabase upsert error', error.message);
    if (isGlobalSlugUniqueViolation(error)) {
      throw new Error(
        'Public slug conflict: another account already uses this handle. Slugs are immutable; contact support if this is your account.'
      );
    }
    throw new Error(error.message);
  }

  // eslint-disable-next-line no-console
  console.log('[DISCOVERY] supabase upsert ok rows=', rows.length);
  const afterOk = await listUserAgents();
  const disc = afterOk.filter((a) => a.publicSlug);
  if (discoveryBase) {
    await Promise.all(
      disc.map(async (a) => {
        try {
          const resp = await fetch(`${discoveryBase}/discoverable/register`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              userAgentId: a.id,
              displayName: a.name,
              instructions: a.instructions,
              slug: a.publicSlug,
              enabled: true,
            }),
          });
          if (!resp.ok) {
            // eslint-disable-next-line no-console
            console.log('[DISCOVERY] relay register failed for', a.id, resp.status);
          }
        } catch {
          // best effort
        }
      })
    );
  }
}

export async function loadDiscoverableAgentsIndexFromCloud(): Promise<ReturnType<typeof buildPublicAgentsIndex> | null> {
  if (!supabase) return null;
  const discoveryBase = getDiscoverabilityBaseUrl();
  if (!discoveryBase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('user_agent_id,display_name,slug,enabled')
    .eq('enabled', true)
    .limit(500);
  if (error || !Array.isArray(data)) return null;
  const agents: UserAgent[] = data
    .filter((r) => r && typeof r.slug === 'string' && typeof r.display_name === 'string')
    .map((r) => ({
      id: String(r.user_agent_id || ''),
      name: String(r.display_name || 'Untitled'),
      instructions: '',
      discoverable: true,
      publicSlug: String(r.slug || ''),
    }));
  return buildPublicAgentsIndex({ agents, discoveryBaseUrl: discoveryBase });
}
