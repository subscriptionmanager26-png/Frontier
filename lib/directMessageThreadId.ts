import { computeDirectMessageThreadId, decodeA2aUrlParam, hashAgentUrl } from '@/lib/directThreadIdCore';

export { decodeA2aUrlParam };

/** Single storage key for Direct ↔ same agent as opened from Search / Requests / recents. */
export function directMessageThreadId(userId: string | null | undefined, agentUrlRaw: string): string {
  return computeDirectMessageThreadId(userId, agentUrlRaw);
}

/** Pre-canonical keys (trailing slash only); used to migrate older local data. */
export function legacyDirectMessageThreadId(userId: string | null | undefined, agentUrlRaw: string): string {
  const userScope = userId?.trim() ? `u-${userId.trim()}` : 'u-guest';
  const legacyB = decodeA2aUrlParam(agentUrlRaw).replace(/\/+$/, '');
  return `${userScope}:frontier-ui-direct-${hashAgentUrl(legacyB)}`;
}
