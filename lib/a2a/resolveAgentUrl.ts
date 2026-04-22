import { fetchAgentCardDocument, getAgentNameFromCard } from '@/lib/a2a/agentCard';

export { gatewayRootForAgentDiscovery } from '@/lib/a2a/gatewayUrl';

import { normalizeAgentBaseUrl } from '@/lib/a2a/normalizeAgentBaseUrl';

export { normalizeAgentBaseUrl };

export type DiscoverAgentResult =
  | { ok: false; kind: 'invalid' }
  | { ok: true; kind: 'found'; baseUrl: string; displayName: string }
  | { ok: false; kind: 'unreachable'; baseUrl: string; message: string };

/**
 * Resolve an agent by fetching its well-known agent card.
 */
export async function discoverAgent(rawInput: string, token: string | null): Promise<DiscoverAgentResult> {
  const baseUrl = normalizeAgentBaseUrl(rawInput);
  if (!baseUrl) return { ok: false, kind: 'invalid' };

  try {
    const doc = await fetchAgentCardDocument(baseUrl, token);
    if (doc == null) {
      return {
        ok: false,
        kind: 'unreachable',
        baseUrl,
        message: 'No agent card at /.well-known/agent-card.json or agent.json.',
      };
    }
    const displayName = await getAgentNameFromCard(baseUrl, token);
    return { ok: true, kind: 'found', baseUrl, displayName };
  } catch (e) {
    return {
      ok: false,
      kind: 'unreachable',
      baseUrl,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
