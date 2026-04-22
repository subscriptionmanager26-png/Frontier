import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { McpServer } from '@/types/mcp';

const SERVERS_KEY = 'frontier_mcp_servers_v1';
const AUTH_KEY = (id: string) => `frontier_mcp_auth_${id}`;
const REFRESH_KEY = (id: string) => `frontier_mcp_refresh_${id}`;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeUrl(url: string): string {
  const t = url.trim().replace(/\/+$/, '');
  return t;
}

export async function listServers(): Promise<McpServer[]> {
  const raw = await AsyncStorage.getItem(SERVERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as McpServer[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.createdAt - a.createdAt) : [];
  } catch {
    return [];
  }
}

export async function getServer(id: string): Promise<McpServer | null> {
  const all = await listServers();
  return all.find((s) => s.id === id) ?? null;
}

export type SecretUpdate =
  | { mode: 'unchanged' }
  | { mode: 'set'; value: string }
  | { mode: 'clear' };

export async function saveServer(
  input: Omit<McpServer, 'id' | 'createdAt'> & { id?: string },
  secretUpdate: SecretUpdate = { mode: 'unchanged' }
): Promise<McpServer> {
  const all = await listServers();
  const id = input.id ?? newId();
  const createdAt = input.id ? (all.find((s) => s.id === id)?.createdAt ?? Date.now()) : Date.now();
  const server: McpServer = {
    id,
    name: input.name.trim(),
    baseUrl: normalizeUrl(input.baseUrl),
    transport: input.transport,
    authHeaderName: input.authHeaderName.trim() || 'Authorization',
    createdAt,
  };
  const next = input.id ? all.map((s) => (s.id === id ? server : s)) : [...all, server];
  await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(next));

  if (secretUpdate.mode === 'set' && secretUpdate.value.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[MCP][storage] saveServer set secret:', id, 'len=', secretUpdate.value.length);
    await SecureStore.setItemAsync(AUTH_KEY(id), secretUpdate.value);
  } else if (secretUpdate.mode === 'clear' || (secretUpdate.mode === 'set' && secretUpdate.value.length === 0)) {
    try {
      await SecureStore.deleteItemAsync(AUTH_KEY(id));
    } catch {
      /* no prior secret */
    }
    try {
      await SecureStore.deleteItemAsync(REFRESH_KEY(id));
    } catch {
      /* no refresh */
    }
  }

  return server;
}

/** Removes all MCP server rows and their SecureStore secrets (sign-out / account switch). */
export async function wipeAllMcpServersLocal(): Promise<void> {
  const servers = await listServers();
  for (const s of servers) {
    try {
      await SecureStore.deleteItemAsync(AUTH_KEY(s.id));
    } catch {
      /* ignore */
    }
    try {
      await SecureStore.deleteItemAsync(REFRESH_KEY(s.id));
    } catch {
      /* ignore */
    }
  }
  await AsyncStorage.removeItem(SERVERS_KEY);
}

export async function deleteServer(id: string): Promise<void> {
  const all = await listServers();
  await AsyncStorage.setItem(
    SERVERS_KEY,
    JSON.stringify(all.filter((s) => s.id !== id))
  );
  try {
    await SecureStore.deleteItemAsync(AUTH_KEY(id));
  } catch {
    /* missing key is fine */
  }
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY(id));
  } catch {
    /* missing key is fine */
  }
}

export async function setRefreshToken(id: string, token: string | null): Promise<void> {
  if (!token?.length) {
    try {
      await SecureStore.deleteItemAsync(REFRESH_KEY(id));
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(REFRESH_KEY(id), token);
}

export async function getRefreshToken(id: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY(id));
  } catch {
    return null;
  }
}

export async function getSecret(id: string): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(AUTH_KEY(id));
    // eslint-disable-next-line no-console
    console.log('[MCP][storage] getSecret:', id, 'exists=', !!v, v ? 'len=' + v.length : '');
    return v;
  } catch {
    return null;
  }
}

export { newId, normalizeUrl };
