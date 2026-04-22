import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { getA2aToken, getEmbeddedA2aGatewayBaseUrl, setA2aBaseUrl, setA2aToken } from '@/lib/appSettings';

const LIST_KEY = 'settings_a2a_agent_connections_v1';
const PRIMARY_KEY = 'settings_a2a_primary_agent_id';

export type AgentConnection = {
  id: string;
  label: string;
  url: string;
};

function bearerKey(id: string): string {
  return `a2a_agent_conn_bearer_${id}`;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function migrateFromLegacyIfNeeded(): Promise<void> {
  const raw = await AsyncStorage.getItem(LIST_KEY);
  if (raw != null) return;
  const url = getEmbeddedA2aGatewayBaseUrl().trim();
  const token = await getA2aToken();
  const id = newId();
  const row: AgentConnection = {
    id,
    label: 'Default',
    url: url || '',
  };
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify([row]));
  await AsyncStorage.setItem(PRIMARY_KEY, id);
  if (token?.trim()) {
    try {
      await SecureStore.setItemAsync(bearerKey(id), token.trim());
    } catch {
      /* ignore */
    }
  }
  await applyPrimaryToAppSettings(id);
}

/**
 * Removes saved agent connections and per-connection bearer tokens from the device.
 * Used on sign-out / account switch so the next user does not inherit another account’s agents.
 */
export async function wipeLocalAgentConnectionsForAccountSwitch(): Promise<void> {
  const raw = await AsyncStorage.getItem(LIST_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          if (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string') {
            try {
              await SecureStore.deleteItemAsync(bearerKey((x as { id: string }).id));
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  await AsyncStorage.removeItem(LIST_KEY);
  await AsyncStorage.removeItem(PRIMARY_KEY);
}

export async function listAgentConnections(): Promise<AgentConnection[]> {
  await migrateFromLegacyIfNeeded();
  const raw = await AsyncStorage.getItem(LIST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is AgentConnection => {
        if (!x || typeof x !== 'object') return false;
        const o = x as Record<string, unknown>;
        return typeof o.id === 'string' && typeof o.url === 'string' && typeof o.label === 'string';
      })
      .map((x) => ({ ...x, label: x.label || 'Agent', url: x.url.trim() }));
  } catch {
    return [];
  }
}

export async function getPrimaryAgentId(): Promise<string | null> {
  await migrateFromLegacyIfNeeded();
  return (await AsyncStorage.getItem(PRIMARY_KEY))?.trim() || null;
}

export async function getBearerForAgent(id: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(bearerKey(id));
  } catch {
    return null;
  }
}

export async function setBearerForAgent(id: string, token: string | null): Promise<void> {
  if (!token?.trim()) {
    try {
      await SecureStore.deleteItemAsync(bearerKey(id));
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(bearerKey(id), token.trim());
}

async function persistList(agents: AgentConnection[]): Promise<void> {
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(agents));
}

export async function applyPrimaryToAppSettings(primaryId: string | null): Promise<void> {
  if (!primaryId) return;
  const agents = await listAgentConnections();
  const row = agents.find((a) => a.id === primaryId);
  if (!row) return;
  await setA2aBaseUrl(row.url.trim());
  const bearer = await getBearerForAgent(primaryId);
  await setA2aToken(bearer?.trim() ? bearer : null);
}

export async function setPrimaryAgentId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(PRIMARY_KEY, id);
  else await AsyncStorage.removeItem(PRIMARY_KEY);
  await applyPrimaryToAppSettings(id);
}

export async function addAgentConnection(args: { label: string; url: string }): Promise<AgentConnection> {
  const agents = await listAgentConnections();
  const row: AgentConnection = {
    id: newId(),
    label: args.label.trim() || 'Agent',
    url: args.url.trim(),
  };
  agents.push(row);
  await persistList(agents);
  const primary = await getPrimaryAgentId();
  if (!primary && row.url) await setPrimaryAgentId(row.id);
  return row;
}

export async function updateAgentConnection(
  id: string,
  patch: Partial<Pick<AgentConnection, 'label' | 'url'>>
): Promise<void> {
  const agents = await listAgentConnections();
  const i = agents.findIndex((a) => a.id === id);
  if (i < 0) return;
  if (patch.label !== undefined) agents[i]!.label = patch.label.trim() || 'Agent';
  if (patch.url !== undefined) agents[i]!.url = patch.url.trim();
  await persistList(agents);
  const primary = await getPrimaryAgentId();
  if (primary === id) await applyPrimaryToAppSettings(id);
}

export async function removeAgentConnection(id: string): Promise<void> {
  const agents = (await listAgentConnections()).filter((a) => a.id !== id);
  await setBearerForAgent(id, null);
  if (agents.length === 0) {
    await AsyncStorage.removeItem(LIST_KEY);
    await AsyncStorage.removeItem(PRIMARY_KEY);
    return;
  }
  await persistList(agents);
  const primary = await getPrimaryAgentId();
  if (primary === id) {
    const next = agents[0]!;
    await setPrimaryAgentId(next.id);
  }
}
