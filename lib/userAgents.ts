import AsyncStorage from '@react-native-async-storage/async-storage';

import { emailToPublicSlug } from '@/lib/publicIdentitySlug';
import { supabase } from '@/lib/supabase';

const LEGACY_STORAGE_KEY = 'frontier_user_agents_v1';
const STORAGE_KEY_PREFIX = 'frontier_user_agents_v1';
const LEGACY_SEEDED_KEY = 'frontier_user_agents_seeded_legacy_v1';

export type UserAgent = {
  id: string;
  name: string;
  instructions: string;
  /** If set, A2A requests for this persona use this base URL instead of global settings. */
  baseUrlOverride?: string;
  /**
   * Legacy field; always treated as true. Public directory listing is tied to having a profile (user agent + slug);
   * to disappear from discovery, remove the user agent / account per product rules.
   */
  discoverable?: boolean;
  /** Stable URL-safe handle derived from account email at signup; not editable in-app. */
  publicSlug?: string;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const DEFAULT_AGENT: Omit<UserAgent, 'id'> = {
  name: 'My Agent',
  instructions:
    'You are the user personal agent. Help with tasks and conversations in a concise, reliable way.',
  discoverable: true,
};

/** Normalizes user-chosen public username / slug (lowercase, hyphens, alnum). */
export function sanitizeAgentUsername(raw: string | undefined): string | undefined {
  const s = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || undefined;
}

/** Deterministic URL slug from display name — never random (stability across logins). */
function slugFromName(name: string): string {
  return sanitizeAgentUsername(name) || 'agent';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

async function resolveAgentsStorageKey(): Promise<string | null> {
  if (!supabase) return LEGACY_STORAGE_KEY;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  return `${STORAGE_KEY_PREFIX}:${session.user.id}`;
}

async function readAll(): Promise<UserAgent[]> {
  const key = await resolveAgentsStorageKey();
  if (!key) return [];
  try {
    let raw = await AsyncStorage.getItem(key);
    if (!raw && key !== LEGACY_STORAGE_KEY) {
      const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        raw = legacy;
        await AsyncStorage.setItem(key, legacy);
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is UserAgent =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as UserAgent).id === 'string' &&
          typeof (x as UserAgent).name === 'string' &&
          typeof (x as UserAgent).instructions === 'string'
      )
      .map((x) => ({
        id: x.id,
        name: x.name.trim() || 'Untitled',
        instructions: x.instructions || '',
        baseUrlOverride: x.baseUrlOverride?.trim() || undefined,
        discoverable: true,
        publicSlug: sanitizeAgentUsername(x.publicSlug),
      }));
  } catch {
    return [];
  }
}

async function writeAll(agents: UserAgent[]): Promise<void> {
  const key = await resolveAgentsStorageKey();
  if (!key) return;
  await AsyncStorage.setItem(key, JSON.stringify(agents));
}

async function syncDiscoverabilityCloudBestEffort(): Promise<void> {
  try {
    const mod = await import('@/lib/discoverableAgentsCloudStore');
    await mod.pushDiscoverableAgentsToCloud();
  } catch {
    // ignore cloud sync failures
  }
}

/**
 * Legacy `public_username` in auth metadata (if set) wins; otherwise slug is derived from email.
 * Both are immutable after signup for a given account.
 */
async function getIdentitySlugFromAuthSession(): Promise<string | undefined> {
  if (!supabase) return undefined;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const rawMeta = session?.user?.user_metadata?.public_username;
  if (typeof rawMeta === 'string' && rawMeta.trim()) {
    const s = sanitizeAgentUsername(rawMeta.trim());
    if (s) return s;
  }
  const em = session?.user?.email;
  if (em?.includes('@')) {
    const fromEmail = emailToPublicSlug(em);
    return fromEmail || undefined;
  }
  return undefined;
}

export async function listUserAgents(): Promise<UserAgent[]> {
  let agents = await readAll();
  // Offline / no Supabase: seed a single local agent once (no auth usernames).
  if (!supabase && agents.length === 0 && (await AsyncStorage.getItem(LEGACY_SEEDED_KEY)) !== '1') {
    const a: UserAgent = {
      ...DEFAULT_AGENT,
      id: newId(),
      publicSlug: `${sanitizeAgentUsername(slugFromName(DEFAULT_AGENT.name))}-${randomSuffix()}`,
    };
    await writeAll([a]);
    await AsyncStorage.setItem(LEGACY_SEEDED_KEY, '1');
    agents = [a];
  }
  // Current product rule: single user agent only (no sub-agents yet).
  return agents.slice(0, 1);
}

export async function getUserAgent(id: string): Promise<UserAgent | null> {
  const agents = await listUserAgents();
  return agents.find((a) => a.id === id) ?? null;
}

export async function addUserAgent(input: {
  name: string;
  instructions: string;
  baseUrlOverride?: string;
}): Promise<UserAgent> {
  const agents = await listUserAgents();
  const agent: UserAgent = {
    id: newId(),
    name: input.name.trim() || 'New agent',
    instructions: input.instructions.trim(),
    baseUrlOverride: input.baseUrlOverride?.trim() || undefined,
    discoverable: true,
    publicSlug: slugFromName(input.name),
  };
  await writeAll([...agents, agent]);
  await syncDiscoverabilityCloudBestEffort();
  return agent;
}

export async function updateUserAgent(
  id: string,
  patch: Partial<Pick<UserAgent, 'name' | 'instructions' | 'baseUrlOverride'>>,
  options?: { skipDiscoverabilityPush?: boolean }
): Promise<UserAgent | null> {
  const agents = await listUserAgents();
  const i = agents.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const cur = agents[i]!;
  const next: UserAgent = {
    ...cur,
    discoverable: true,
    ...(patch.name != null ? { name: patch.name.trim() || cur.name } : {}),
    ...(patch.instructions != null ? { instructions: patch.instructions.trim() } : {}),
    ...(patch.baseUrlOverride !== undefined
      ? { baseUrlOverride: patch.baseUrlOverride?.trim() || undefined }
      : {}),
  };
  agents[i] = next;
  await writeAll(agents);
  if (!options?.skipDiscoverabilityPush) {
    await syncDiscoverabilityCloudBestEffort();
  }
  return next;
}

export async function removeUserAgent(id: string): Promise<boolean> {
  const agents = await listUserAgents();
  const next = agents.filter((a) => a.id !== id);
  if (next.length === agents.length) return false;
  await writeAll(next);
  await syncDiscoverabilityCloudBestEffort();
  return true;
}

export async function mergeUserAgentsFromCloud(entries: UserAgent[]): Promise<void> {
  const local = await listUserAgents();
  const byId = new Map<string, UserAgent>();
  for (const a of [...local, ...entries]) {
    const id = a.id?.trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, {
        id,
        name: a.name?.trim() || 'Untitled',
        instructions: a.instructions || '',
        baseUrlOverride: a.baseUrlOverride?.trim() || undefined,
        discoverable: true,
        publicSlug: sanitizeAgentUsername(a.publicSlug) || slugFromName(a.name || 'agent'),
      });
      continue;
    }
    byId.set(id, {
      ...prev,
      ...a,
      id,
      name: a.name?.trim() || prev.name,
      instructions: typeof a.instructions === 'string' ? a.instructions : prev.instructions,
      baseUrlOverride: a.baseUrlOverride?.trim() || prev.baseUrlOverride,
      discoverable: true,
      publicSlug:
        sanitizeAgentUsername(a.publicSlug) || prev.publicSlug || slugFromName(a.name || prev.name),
    });
  }
  await writeAll(Array.from(byId.values()));
  await syncDiscoverabilityCloudBestEffort();
}

export type EnsurePrimaryUserAgentOptions = {
  /** Display name default (e.g. from email local-part). Duplicates allowed across users. */
  defaultName?: string;
};

export async function ensurePrimaryUserAgent(options?: EnsurePrimaryUserAgentOptions): Promise<UserAgent> {
  const agents = await readAll();
  const defaultName = options?.defaultName?.trim() || DEFAULT_AGENT.name;

  const mod = await import('@/lib/discoverableAgentsCloudStore');
  const cloudRow = await mod.fetchMyDiscoverableCardFromCloud();
  const cloudSlug = cloudRow?.slug ? sanitizeAgentUsername(cloudRow.slug) : undefined;
  const cloudUserAgentId = cloudRow?.userAgentId?.trim() || undefined;

  const identitySlug = await getIdentitySlugFromAuthSession();

  /** Order: local slug → cloud → auth (legacy metadata or email-derived slug) → name-derived. Never random. */
  const resolveSlug = (existing?: string | null): string => {
    const s =
      sanitizeAgentUsername(existing === null || existing === undefined ? undefined : existing) ||
      cloudSlug ||
      identitySlug ||
      slugFromName(defaultName);
    return sanitizeAgentUsername(s) || slugFromName(defaultName);
  };

  /** Must match discoverable_user_agents.user_agent_id or upsert INSERTs a second row and hits global slug uniqueness. */
  const stableAgentId = (localId: string): string => {
    if (cloudUserAgentId && cloudUserAgentId.length > 0 && cloudUserAgentId !== localId) {
      return cloudUserAgentId;
    }
    return localId;
  };

  if (agents.length > 0) {
    const first = agents[0]!;
    const normalized: UserAgent = {
      ...first,
      id: stableAgentId(first.id),
      name: first.name?.trim() || defaultName,
      discoverable: true,
      publicSlug: resolveSlug(first.publicSlug),
    };
    const prev = JSON.stringify({
      id: first.id,
      name: first.name?.trim(),
      publicSlug: sanitizeAgentUsername(first.publicSlug),
    });
    const nextStr = JSON.stringify({
      id: normalized.id,
      name: normalized.name,
      publicSlug: normalized.publicSlug,
    });
    if (prev !== nextStr) {
      await writeAll([normalized, ...agents.slice(1)]);
    }
    return normalized;
  }

  const publicSlug = resolveSlug(null);

  const created: UserAgent = {
    id: cloudUserAgentId && cloudUserAgentId.length > 0 ? cloudUserAgentId : newId(),
    name: defaultName,
    instructions: DEFAULT_AGENT.instructions,
    baseUrlOverride: undefined,
    discoverable: true,
    publicSlug,
  };
  await writeAll([created]);
  await syncDiscoverabilityCloudBestEffort();
  return created;
}

/**
 * Removes legacy single-key storage and all `frontier_user_agents_v1:<userId>` entries so the next
 * account cannot inherit another user's profile via the legacy → per-user migration in `readAll`.
 */
export async function wipeAllUserAgentAsyncStorageKeys(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter(
    (k) =>
      k === LEGACY_STORAGE_KEY ||
      k === LEGACY_SEEDED_KEY ||
      k.startsWith(`${STORAGE_KEY_PREFIX}:`)
  );
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove);
  }
}
