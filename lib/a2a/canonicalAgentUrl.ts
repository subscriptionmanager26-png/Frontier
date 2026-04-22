import { normalizeAgentBaseUrl } from '@/lib/a2a/normalizeAgentBaseUrl';

/** Trim + strip trailing slashes (fallback when URL parse fails). */
export function normalizeStoredAgentUrl(agentUrl: string): string {
  return agentUrl.trim().replace(/\/+$/, '');
}

/**
 * Single key for session map, recents, and UI: URL parse when possible so directory rpc URLs
 * align with gateway/session baseUrl; otherwise trim + strip trailing slashes.
 */
export function canonicalA2aAgentUrl(agentUrl: string): string {
  const t = agentUrl.trim();
  if (!t) return '';
  const base = normalizeAgentBaseUrl(t);
  return base ?? normalizeStoredAgentUrl(t);
}
