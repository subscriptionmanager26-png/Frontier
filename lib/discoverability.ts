import Constants from 'expo-constants';

import { getPublicA2aGatewayBaseUrlSync } from '@/lib/appSettings';
import type { UserAgent } from '@/lib/userAgents';

export type PublicAgentCard = {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: 'JSONRPC';
  supportedInterfaces: Array<{
    transport: 'JSONRPC';
    url: string;
    protocolVersion: string;
  }>;
  security: Array<{ type: 'none' | 'bearer' }>;
  tags: string[];
  metadata: {
    source: 'frontier-user-agent';
    userAgentId: string;
    publicSlug: string;
  };
};

export type PublicAgentsIndex = {
  version: 1;
  generatedAt: string;
  agents: Array<{
    id: string;
    name: string;
    slug: string;
    cardUrl: string;
  }>;
};

function readExtra(key: string): string {
  const fromEnv = process.env[key];
  if (fromEnv?.trim()) return fromEnv.trim();
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
  const fromExtra = extra[key];
  return typeof fromExtra === 'string' ? fromExtra.trim() : '';
}

/** Hosted discovery / agent-card index; falls back to public A2A gateway origin when only that is set. */
export function getDiscoverabilityBaseUrl(): string {
  const d = readExtra('EXPO_PUBLIC_DISCOVERY_BASE_URL').replace(/\/+$/, '');
  if (d) return d;
  return getPublicA2aGatewayBaseUrlSync();
}

export function buildPublicAgentCard(args: {
  agent: UserAgent;
  discoveryBaseUrl: string;
  rpcBaseUrl: string;
}): PublicAgentCard {
  const rpc = `${args.rpcBaseUrl.replace(/\/+$/, '')}/a2a/v1/${args.agent.publicSlug}`;
  return {
    protocolVersion: '1.0',
    name: args.agent.name,
    description: args.agent.instructions || `${args.agent.name} user agent`,
    url: rpc,
    preferredTransport: 'JSONRPC',
    supportedInterfaces: [{ transport: 'JSONRPC', url: rpc, protocolVersion: '1.0' }],
    security: [{ type: 'bearer' }],
    tags: ['frontier', 'user-agent'],
    metadata: {
      source: 'frontier-user-agent',
      userAgentId: args.agent.id,
      publicSlug: args.agent.publicSlug || '',
    },
  };
}

export function buildPublicAgentsIndex(args: {
  agents: UserAgent[];
  discoveryBaseUrl: string;
}): PublicAgentsIndex {
  const base = args.discoveryBaseUrl.replace(/\/+$/, '');
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    agents: args.agents
      .filter((a) => !!a.publicSlug)
      .map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.publicSlug!,
        cardUrl: `${base}/.well-known/frontier-agents/${a.publicSlug}/agent-card.json`,
      })),
  };
}
