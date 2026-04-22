import { normalizeAgentBaseUrl } from '@/lib/a2a/normalizeAgentBaseUrl';

/** Same hash as legacy `directMessageThreadId` (must stay stable for storage keys). */
export function hashAgentUrl(url: string): string {
  const s = url.trim();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function decodeA2aUrlParam(raw: string): string {
  const t = raw.trim();
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

export function computeCanonicalA2aAgentUrl(agentUrl: string): string {
  const t = agentUrl.trim();
  if (!t) return '';
  const base = normalizeAgentBaseUrl(t);
  return base ?? t.replace(/\/+$/, '');
}

/**
 * Stable thread id for Direct ↔ peer RPC URL (matches `directMessageThreadId` / gateway).
 * Keep in sync with duplicate logic in `supabase/functions/a2a-gateway/gateway-logic.ts`.
 */
export function computeDirectMessageThreadId(userId: string | null | undefined, agentUrlRaw: string): string {
  const userScope = userId?.trim() ? `u-${userId.trim()}` : 'u-guest';
  const decoded = decodeA2aUrlParam(agentUrlRaw);
  const base = computeCanonicalA2aAgentUrl(decoded);
  return `${userScope}:frontier-ui-direct-${hashAgentUrl(base)}`;
}
