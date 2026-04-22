import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

import { wipeLocalAgentConnectionsForAccountSwitch } from '@/lib/a2aAgentConnections';
import { supabase } from '@/lib/supabase';
import { logUxFlow } from '@/lib/uxFlowLog';
import { ACTIVE_SUBSCRIPTIONS_KEY, SUBSCRIPTION_FEED_STORAGE_KEY } from '@/lib/a2aLocalStateKeys';
import { resetA2aCloudRestoreDedupe } from '@/lib/cloudA2aState';
import { setActiveServerId } from '@/lib/activeServer';
import { getChatMemoryDb } from '@/lib/chatMemory';
import { wipeAllMcpServersLocal } from '@/lib/serverStorage';
import { wipeAllUserAgentAsyncStorageKeys } from '@/lib/userAgents';
import { requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { FRONTIER_A2A_TRACKING_STORAGE_UPDATED } from '@/lib/subscriptionUpdatesFeed';

const CHANNEL_MESSAGES_PREFIX = 'frontier-channel-messages-v1';
const A2A_OAUTH_TOKEN_BY_BASE_KEY = 'frontier_a2a_oauth_token_by_base_v1';
const EMISSIONS_PREFIX = 'frontier_emissions_v1';
const EMISSIONS_CURSOR_PREFIX = 'frontier_emissions_cursor_v1';

/**
 * Removes local chat + A2A caches so another account on the same device cannot see the previous
 * user's conversations, direct list, subscriptions, or OAuth tokens keyed by agent URL.
 * Call while still authenticated (before signOut) if you need cloud push first.
 */
export async function clearSessionLocalCaches(reason = 'unspecified'): Promise<void> {
  let userId: string | null = null;
  try {
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      userId = data?.session?.user?.id ?? null;
    }
  } catch {
    userId = null;
  }
  await logUxFlow('ux.flow.cache.clear_session', {
    reason,
    userId,
    note:
      'Clears local threads + SQLite a2a_logs/session; channel_messages in Supabase are per user_id and are not deleted here.',
  });
  resetA2aCloudRestoreDedupe();
  await wipeLocalAgentConnectionsForAccountSwitch();
  await wipeAllUserAgentAsyncStorageKeys();
  await wipeAllMcpServersLocal();
  await setActiveServerId(null);

  const allKeys = await AsyncStorage.getAllKeys();
  const extra = allKeys.filter(
    (k) =>
      k.startsWith(CHANNEL_MESSAGES_PREFIX) ||
      k.startsWith(EMISSIONS_PREFIX) ||
      k.startsWith(EMISSIONS_CURSOR_PREFIX) ||
      k.startsWith('mcp_oauth_pending_')
  );
  const toRemove = [
    ...new Set([
      ...extra,
      ACTIVE_SUBSCRIPTIONS_KEY,
      SUBSCRIPTION_FEED_STORAGE_KEY,
      A2A_OAUTH_TOKEN_BY_BASE_KEY,
    ]),
  ];
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove);
  }

  try {
    const db = await getChatMemoryDb();
    await db.execAsync(`
      DELETE FROM a2a_session_map;
      DELETE FROM a2a_direct_recents;
      DELETE FROM a2a_logs;
      DELETE FROM notification_log;
      DELETE FROM tool_registry;
    `);
  } catch {
    // SQLite may be locked briefly; sign-out still proceeds.
  }

  DeviceEventEmitter.emit(FRONTIER_A2A_TRACKING_STORAGE_UPDATED);
  requestA2aUiRefresh();
}

/**
 * Removes all local chat threads, Direct/session metadata, subscription pointers, and related SQLite rows.
 * Does **not** sign you out, does not remove user agents, MCP servers, or app settings — only conversation state.
 * Use when testing flows from a clean slate; cloud-backed `channel_messages` may still rehydrate on next open unless cleared server-side.
 */
export async function nukeLocalChatDataForTesting(): Promise<void> {
  let userId: string | null = null;
  try {
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      userId = data?.session?.user?.id ?? null;
    }
  } catch {
    userId = null;
  }
  await logUxFlow('ux.flow.cache.nuke_local_testing', {
    userId,
    note: 'Settings → Clear all local conversations. Cloud channel_messages unchanged.',
  });
  resetA2aCloudRestoreDedupe();
  const allKeys = await AsyncStorage.getAllKeys();
  const extra = allKeys.filter(
    (k) =>
      k.startsWith(CHANNEL_MESSAGES_PREFIX) ||
      k.startsWith(EMISSIONS_PREFIX) ||
      k.startsWith(EMISSIONS_CURSOR_PREFIX) ||
      k.startsWith('mcp_oauth_pending_')
  );
  const toRemove = [
    ...new Set([
      ...extra,
      ACTIVE_SUBSCRIPTIONS_KEY,
      SUBSCRIPTION_FEED_STORAGE_KEY,
      A2A_OAUTH_TOKEN_BY_BASE_KEY,
    ]),
  ];
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove);
  }
  try {
    const db = await getChatMemoryDb();
    await db.execAsync(`
      DELETE FROM a2a_session_map;
      DELETE FROM a2a_direct_recents;
      DELETE FROM a2a_logs;
      DELETE FROM notification_log;
    `);
  } catch {
    // ignore
  }
  DeviceEventEmitter.emit(FRONTIER_A2A_TRACKING_STORAGE_UPDATED);
  requestA2aUiRefresh();
}
