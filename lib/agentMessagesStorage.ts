import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AgentUiMessage } from '@/hooks/useAgent';
import { requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { loadCloudMessages, saveCloudMessages } from '@/lib/cloudMessageStore';
import { threadRootIdForMessage } from '@/lib/threadMessages';

const STORAGE_PREFIX = 'frontier-channel-messages-v1';

export function messagesStorageKey(threadId: string): string {
  return `${STORAGE_PREFIX}:${threadId}`;
}

export async function loadMessagesFromStorage(threadId: string): Promise<AgentUiMessage[] | null> {
  try {
    const raw = await AsyncStorage.getItem(messagesStorageKey(threadId));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as AgentUiMessage[];
    }
  } catch {
    // ignore local parse errors; cloud fallback below
  }
  try {
    const cloud = await loadCloudMessages(threadId);
    if (!cloud) return null;
    await AsyncStorage.setItem(messagesStorageKey(threadId), JSON.stringify(cloud));
    return cloud;
  } catch {
    return null;
  }
}

export async function saveMessagesToStorage(threadId: string, messages: AgentUiMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(messagesStorageKey(threadId), JSON.stringify(messages));
    requestA2aUiRefresh();
  } catch {
    // quota / device limits — ignore
  }
  void saveCloudMessages(threadId, messages).catch(() => {
    // best-effort cloud sync
  });
}

/**
 * Deletes one thread root from both local cache and cloud backup for this channel thread id.
 * This is explicit (not debounce-based) so delete survives app restarts/reinstalls deterministically.
 */
export async function deleteThreadFromStorage(threadId: string, rootId: string): Promise<void> {
  const local = (await loadMessagesFromStorage(threadId)) ?? [];
  const prunedLocal = local.filter((m) => threadRootIdForMessage(local, m.id) !== rootId);
  await AsyncStorage.setItem(messagesStorageKey(threadId), JSON.stringify(prunedLocal));
  requestA2aUiRefresh();
  try {
    const cloud = (await loadCloudMessages(threadId)) ?? prunedLocal;
    const prunedCloud = cloud.filter((m) => threadRootIdForMessage(cloud, m.id) !== rootId);
    await saveCloudMessages(threadId, prunedCloud);
  } catch {
    // best-effort cloud delete
  }
}
