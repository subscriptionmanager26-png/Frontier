import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

import { ACTIVE_SUBSCRIPTIONS_KEY, SUBSCRIPTION_FEED_STORAGE_KEY } from '@/lib/a2aLocalStateKeys';
import { FRONTIER_A2A_TRACKING_STORAGE_UPDATED } from '@/lib/subscriptionUpdatesFeed';
import {
  exportAllA2aLogsForCloud,
  mergeA2aLogsFromCloud,
  rehydrateDirectRecentsFromA2aLogs,
  type A2aLogExportRow,
} from '@/lib/a2a/store';
import {
  exportEmissionCursors,
  exportEmissionsForCloud,
  importEmissionCursors,
  mergeEmissionsFromCloud,
  type EmissionCloudEntry,
} from '@/lib/emissionsLog';
import type { ActiveSubscriptionRecord } from '@/lib/subscriptionPushBridge';
import type { SubscriptionFeedItem } from '@/lib/subscriptionUpdatesFeed';
import { requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { supabase } from '@/lib/supabase';
import { listUserAgents, mergeUserAgentsFromCloud, type UserAgent } from '@/lib/userAgents';

const TABLE = 'user_a2a_device_state';
const MAX_FEED_ITEMS = 500;

export type CloudA2aPayloadV1 = {
  v: 1;
  activeSubscriptions: ActiveSubscriptionRecord[];
  subscriptionFeed: SubscriptionFeedItem[];
  a2aLogs: A2aLogExportRow[];
  userAgents?: UserAgent[];
  emissionCursors?: Record<string, number>;
  /** Per-task emission archive (relay / webhook history), capped on push. */
  emissions?: EmissionCloudEntry[];
};

let lastMergedUserId: string | null = null;

export function resetA2aCloudRestoreDedupe(): void {
  lastMergedUserId = null;
}

function parsePayload(raw: unknown): CloudA2aPayloadV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (!Array.isArray(o.activeSubscriptions) || !Array.isArray(o.subscriptionFeed) || !Array.isArray(o.a2aLogs)) {
    return null;
  }
  if (o.userAgents !== undefined && !Array.isArray(o.userAgents)) return null;
  if (o.emissions !== undefined && !Array.isArray(o.emissions)) return null;
  return raw as CloudA2aPayloadV1;
}

function mergeSubsRecords(a: ActiveSubscriptionRecord[], b: ActiveSubscriptionRecord[]): ActiveSubscriptionRecord[] {
  const byTask = new Map<string, ActiveSubscriptionRecord>();
  for (const s of [...a, ...b]) {
    const tid = s.taskId?.trim();
    const bu = s.baseUrl?.trim();
    if (!tid || !bu) continue;
    const prev = byTask.get(tid);
    if (!prev) {
      byTask.set(tid, { ...s, taskId: tid, baseUrl: bu });
      continue;
    }
    byTask.set(tid, {
      ...prev,
      ...s,
      taskId: tid,
      baseUrl: bu,
      unsubscribeTaskId: s.unsubscribeTaskId || prev.unsubscribeTaskId,
      sessionId: s.sessionId || prev.sessionId,
      runCount:
        typeof s.runCount === 'number' || typeof prev.runCount === 'number'
          ? Math.max(s.runCount ?? 0, prev.runCount ?? 0)
          : undefined,
    });
  }
  return Array.from(byTask.values());
}

function mergeFeedsById(local: SubscriptionFeedItem[], remote: SubscriptionFeedItem[]): SubscriptionFeedItem[] {
  const byId = new Map<string, SubscriptionFeedItem>();
  for (const x of [...remote, ...local]) {
    if (!x?.id) continue;
    const prev = byId.get(x.id);
    if (!prev || x.receivedAt >= prev.receivedAt) byId.set(x.id, x);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, MAX_FEED_ITEMS);
}

export async function pushA2aDeviceStateToCloud(): Promise<void> {
  if (!supabase) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return;

  const [subsRaw, feedRaw, logs, userAgents, cursors, emissions] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_SUBSCRIPTIONS_KEY),
    AsyncStorage.getItem(SUBSCRIPTION_FEED_STORAGE_KEY),
    exportAllA2aLogsForCloud(),
    listUserAgents(),
    exportEmissionCursors(),
    exportEmissionsForCloud(),
  ]);

  let activeSubscriptions: ActiveSubscriptionRecord[] = [];
  try {
    const p = subsRaw ? JSON.parse(subsRaw) : [];
    activeSubscriptions = Array.isArray(p) ? p.filter((x) => x?.taskId && x?.baseUrl) : [];
  } catch {
    activeSubscriptions = [];
  }

  let subscriptionFeed: SubscriptionFeedItem[] = [];
  try {
    const p = feedRaw ? JSON.parse(feedRaw) : [];
    subscriptionFeed = Array.isArray(p) ? p : [];
  } catch {
    subscriptionFeed = [];
  }

  const payload: CloudA2aPayloadV1 = {
    v: 1,
    activeSubscriptions,
    subscriptionFeed: subscriptionFeed.slice(0, MAX_FEED_ITEMS),
    a2aLogs: logs,
    userAgents,
    emissionCursors: Object.keys(cursors).length ? cursors : undefined,
    emissions: emissions.length > 0 ? emissions : undefined,
  };

  await supabase.from(TABLE).upsert(
    {
      user_id: session.user.id,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

/**
 * Merges cloud snapshot into local AsyncStorage + SQLite. Safe to call once after sign-in.
 */
export async function restoreA2aDeviceStateFromCloud(userId: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[RESTORE] started');
  if (!supabase || !userId) return;
  if (lastMergedUserId === userId) return;

  const { data, error } = await supabase
    .from(TABLE)
    .select('payload')
    .eq('user_id', userId)
    .maybeSingle<{ payload: unknown }>();

  if (error) return;

  if (!data?.payload) {
    lastMergedUserId = userId;
    return;
  }

  const payload = parsePayload(data.payload);
  if (!payload) {
    lastMergedUserId = userId;
    return;
  }

  let didMerge = false;
  let restoredSubsCount = 0;

  if (payload.activeSubscriptions.length > 0) {
    const localRaw = await AsyncStorage.getItem(ACTIVE_SUBSCRIPTIONS_KEY);
    let local: ActiveSubscriptionRecord[] = [];
    try {
      const p = localRaw ? JSON.parse(localRaw) : [];
      local = Array.isArray(p) ? p.filter((x) => x?.taskId && x?.baseUrl) : [];
    } catch {
      local = [];
    }
    const merged = mergeSubsRecords(local, payload.activeSubscriptions);
    await AsyncStorage.setItem(ACTIVE_SUBSCRIPTIONS_KEY, JSON.stringify(merged));
    restoredSubsCount = merged.length;
    didMerge = true;
  }

  if (payload.subscriptionFeed.length > 0) {
    const localRaw = await AsyncStorage.getItem(SUBSCRIPTION_FEED_STORAGE_KEY);
    let local: SubscriptionFeedItem[] = [];
    try {
      const p = localRaw ? JSON.parse(localRaw) : [];
      local = Array.isArray(p) ? p : [];
    } catch {
      local = [];
    }
    const merged = mergeFeedsById(local, payload.subscriptionFeed);
    await AsyncStorage.setItem(SUBSCRIPTION_FEED_STORAGE_KEY, JSON.stringify(merged));
    didMerge = true;
  }

  if (payload.a2aLogs.length > 0) {
    await mergeA2aLogsFromCloud(payload.a2aLogs);
    const directRecents = await rehydrateDirectRecentsFromA2aLogs();
    didMerge = true;
    // #region agent log
    fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '583810' },
      body: JSON.stringify({
        sessionId: '583810',
        location: 'lib/cloudA2aState.ts:restoreA2aDeviceStateFromCloud',
        message: 'after_merge_logs_rehydrate',
        data: { cloudLogRows: payload.a2aLogs.length, directRecentsRehydrated: directRecents },
        timestamp: Date.now(),
        hypothesisId: 'H1',
      }),
    }).catch(() => {});
    // #endregion
  }

  if (payload.userAgents && payload.userAgents.length > 0) {
    await mergeUserAgentsFromCloud(payload.userAgents);
    didMerge = true;
  }

  if (payload.emissionCursors && Object.keys(payload.emissionCursors).length > 0) {
    await importEmissionCursors(payload.emissionCursors);
    didMerge = true;
  }

  if (payload.emissions && payload.emissions.length > 0) {
    await mergeEmissionsFromCloud(payload.emissions);
    didMerge = true;
  }

  lastMergedUserId = userId;
  if (didMerge) {
    DeviceEventEmitter.emit(FRONTIER_A2A_TRACKING_STORAGE_UPDATED);
    requestA2aUiRefresh();
  }
  // eslint-disable-next-line no-console
  console.log('[RESTORE] done — subs restored:', restoredSubsCount);
}
