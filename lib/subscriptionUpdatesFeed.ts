import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

import { ACTIVE_SUBSCRIPTIONS_KEY, SUBSCRIPTION_FEED_STORAGE_KEY } from '@/lib/a2aLocalStateKeys';
import { logA2aHop } from '@/lib/a2a/store';
import { a2aService } from '@/lib/a2a/service';
import type { A2aTaskResult } from '@/lib/a2a/types';
import {
  getA2aBaseUrl,
  getA2aRetryCount,
  getA2aTaskPushWebhookBearer,
  getA2aTaskPushWebhookUrl,
  getA2aTimeoutMs,
  getA2aToken,
} from '@/lib/appSettings';
import { normalizeAgentBaseUrl } from '@/lib/a2a/resolveAgentUrl';
import { requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { scheduleCloudA2aStatePush } from '@/lib/cloudA2aSyncScheduler';
import {
  getLastSeenSequence,
  getEmissionsSince,
  storeEmission,
  type A2AEvent,
} from '@/lib/emissionsLog';

export { SUBSCRIPTION_FEED_STORAGE_KEY };

/** Active subscription AsyncStorage was updated (cloud restore, ListTasks sync, or user track). */
export const FRONTIER_A2A_TRACKING_STORAGE_UPDATED = 'frontier_a2a_tracking_storage_updated';

const MAX_ITEMS = 500;
/**
 * Replay a small overlap window on every relay pull.
 * This avoids missed updates when local cursor is ahead/stale after sleep/offline cycles.
 */
const RELAY_SEQUENCE_OVERLAP = 20;
let refreshAllInFlight: Promise<void> | null = null;

export type SubscriptionFeedItem = {
  id: string;
  receivedAt: number;
  baseUrl: string;
  taskId: string;
  sequenceNumber?: number;
  isSubscription?: boolean;
  unsubscribeTaskId?: string;
  sessionId?: string;
  status: string;
  output?: string;
  error?: string;
  runCount?: number;
};

type SubRecord = {
  unsubscribeTaskId?: string;
  taskId: string;
  runCount?: number;
  baseUrl?: string;
  sessionId?: string;
};

type RelayEventsResponse = { events?: A2AEvent[] };

function normBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Compare two agent base URLs for feed matching (card normalization, then trailing-slash trim). */
export function comparableSubscriptionAgentBase(url: string): string {
  return normalizeAgentBaseUrl(url) || normBase(url);
}

/** Feed rows whose base URL matches this direct agent. */
export function filterSubscriptionFeedForAgent(
  agentUrl: string,
  items: SubscriptionFeedItem[]
): SubscriptionFeedItem[] {
  const key = comparableSubscriptionAgentBase(agentUrl);
  if (!key) return [];
  return items.filter((item) => comparableSubscriptionAgentBase(item.baseUrl) === key);
}

async function readSubs(): Promise<SubRecord[]> {
  const raw = await AsyncStorage.getItem(ACTIVE_SUBSCRIPTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SubRecord[];
    return Array.isArray(parsed) ? parsed.filter((x) => x?.taskId && x?.baseUrl) : [];
  } catch {
    return [];
  }
}

async function writeSubs(subs: SubRecord[]): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_SUBSCRIPTIONS_KEY, JSON.stringify(subs));
  scheduleCloudA2aStatePush();
}

function mergeSubRecords(a: SubRecord[], b: SubRecord[]): SubRecord[] {
  const byTask = new Map<string, SubRecord>();
  for (const s of [...a, ...b]) {
    const tid = s.taskId?.trim();
    const base = s.baseUrl?.trim();
    if (!tid || !base) continue;
    const prev = byTask.get(tid);
    if (!prev) {
      byTask.set(tid, { ...s, taskId: tid, baseUrl: base });
      continue;
    }
    byTask.set(tid, {
      ...prev,
      ...s,
      taskId: tid,
      baseUrl: base || prev.baseUrl,
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

function parseWallClockMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function eventWallClockMs(event: A2AEvent): number | null {
  const e = event as Record<string, unknown>;
  const meta = (e.metadata as Record<string, unknown> | undefined) || {};
  return (
    parseWallClockMs(e.timestamp) ??
    parseWallClockMs(e.time) ??
    parseWallClockMs(meta.timestamp) ??
    parseWallClockMs(meta.eventTime)
  );
}

export async function trackTaskForUpdates(record: SubRecord): Promise<void> {
  const taskId = record.taskId?.trim();
  const baseUrl = record.baseUrl?.trim();
  if (!taskId || !baseUrl) return;
  const subs = await readSubs();
  const existing = subs.find((s) => s.taskId === taskId || (record.unsubscribeTaskId && s.unsubscribeTaskId === record.unsubscribeTaskId));
  const next: SubRecord = {
    ...existing,
    ...record,
    taskId,
    baseUrl,
    unsubscribeTaskId: record.unsubscribeTaskId || existing?.unsubscribeTaskId,
    sessionId: record.sessionId || existing?.sessionId,
    runCount: record.runCount ?? existing?.runCount,
  };
  const merged = [
    ...subs.filter((s) => s.taskId !== taskId && (!next.unsubscribeTaskId || s.unsubscribeTaskId !== next.unsubscribeTaskId)),
    next,
  ];
  await writeSubs(merged);
}

async function isTrackedTask(taskId: string): Promise<boolean> {
  const subs = await readSubs();
  return subs.some((s) => s.taskId === taskId || s.unsubscribeTaskId === taskId);
}

export async function listSubscriptionFeedItems(): Promise<SubscriptionFeedItem[]> {
  const raw = await AsyncStorage.getItem(SUBSCRIPTION_FEED_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SubscriptionFeedItem[];
    return Array.isArray(parsed)
      ? parsed.filter((x) => x?.isSubscription === true || !!x?.unsubscribeTaskId)
      : [];
  } catch {
    return [];
  }
}

function feedSignature(latest: A2aTaskResult, sequenceNumber?: number): string {
  return `${latest.taskId}|${latest.status}|${latest.output?.slice(0, 400) ?? ''}|${latest.error ?? ''}|${sequenceNumber ?? latest.subscription?.runCount ?? ''}`;
}

function parseMetadataSequence(meta: { sequenceNumber?: unknown } | undefined): number | undefined {
  if (!meta) return undefined;
  const sn = meta.sequenceNumber;
  if (typeof sn === 'number' && Number.isFinite(sn)) return sn;
  if (typeof sn === 'string') {
    const n = Number(sn);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toTaskResultFromEvent(event: A2AEvent): A2aTaskResult | null {
  const taskId = String(event.taskId || event.id || '').trim();
  if (!taskId) return null;
  const statusRaw = String((event as Record<string, unknown>).taskState || (event as Record<string, unknown>).status || '').toLowerCase();
  const e = event as Record<string, unknown>;
  const outputObj = (e.output ?? null) as { text?: unknown } | null;
  const artifact = (e.artifact ?? null) as { parts?: Array<{ text?: unknown }> } | null;
  const outputText =
    typeof outputObj?.text === 'string'
      ? outputObj.text
      : typeof artifact?.parts?.[0]?.text === 'string'
        ? String(artifact.parts[0].text || '')
        : undefined;
  const seq = parseMetadataSequence(event.metadata);
  let status: A2aTaskResult['status'] = 'running';
  if (statusRaw.includes('cancel')) status = 'cancelled';
  else if (statusRaw.includes('fail')) status = 'failed';
  else if (statusRaw.includes('complete')) status = 'completed';
  else if (statusRaw.includes('input_required')) status = 'input_required';
  else if (statusRaw.includes('auth_required')) status = 'auth_required';
  const wall = eventWallClockMs(event);
  return {
    taskId,
    sessionId: String((event as Record<string, unknown>).contextId || taskId),
    status,
    output: outputText,
    remoteUpdatedAtMs: wall ?? undefined,
    subscription: {
      isSubscription: true,
      runCount: seq,
      unsubscribeTaskId: taskId,
    },
  };
}

/**
 * Append a subscription task snapshot (e.g. after a push or Sync). Skips if identical to newest entry for same task.
 */
export async function appendSubscriptionFeedItemFromTask(
  baseUrl: string,
  latest: A2aTaskResult,
  opts?: { wallClockMs?: number; sequenceNumber?: number }
): Promise<void> {
  // Updates feed is explicit-track only.
  if (!(await isTrackedTask(latest.taskId))) return;
  /** Align with `filterSubscriptionFeedForAgent` / Direct list URLs. */
  const b = normalizeAgentBaseUrl(baseUrl) || normBase(baseUrl);
  if (!b) return;

  const prev = await listSubscriptionFeedItems();
  const sig = feedSignature(latest, opts?.sequenceNumber);
  if (prev.some((p) => p.taskId === latest.taskId && feedSignatureFromItem(p) === sig)) {
    return;
  }

  const receivedAt = opts?.wallClockMs ?? latest.remoteUpdatedAtMs ?? Date.now();

  const row: SubscriptionFeedItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    receivedAt,
    baseUrl: b,
    taskId: latest.taskId,
    sequenceNumber: opts?.sequenceNumber ?? latest.subscription?.runCount,
    isSubscription: true,
    unsubscribeTaskId: latest.subscription?.unsubscribeTaskId,
    sessionId: latest.sessionId,
    status: latest.status,
    output: latest.output,
    error: latest.error,
    runCount: latest.subscription?.runCount,
  };

  const next = [row, ...prev].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(SUBSCRIPTION_FEED_STORAGE_KEY, JSON.stringify(next));
  scheduleCloudA2aStatePush();
}

function feedSignatureFromItem(item: SubscriptionFeedItem): string {
  return `${item.taskId}|${item.status}|${item.output?.slice(0, 400) ?? ''}|${item.error ?? ''}|${item.sequenceNumber ?? item.runCount ?? ''}`;
}

/**
 * Full per-task emission history lives in `emissionsLog`; the subscription feed is capped (MAX_ITEMS)
 * and must not be used as the archive source of truth after long sleep windows.
 */
export async function getSubscriptionArchivePendingCount(taskId: string): Promise<number> {
  const events = await getEmissionsSince(taskId, 0);
  return Math.max(0, events.length - 1);
}

/** Archive rows = all emissions except the newest (same as prior UX: headline card + history). */
export async function loadSubscriptionArchiveItemsForTask(opts: {
  taskId: string;
  baseUrl: string;
  unsubscribeTaskId?: string;
}): Promise<SubscriptionFeedItem[]> {
  const events = await getEmissionsSince(opts.taskId, 0);
  if (events.length === 0) return [];
  const b = normalizeAgentBaseUrl(opts.baseUrl) || normBase(opts.baseUrl);
  const sub: SubRecord = {
    taskId: opts.taskId,
    baseUrl: opts.baseUrl,
    unsubscribeTaskId: opts.unsubscribeTaskId,
  };
  const items: SubscriptionFeedItem[] = [];
  let idx = 0;
  for (const e of events) {
    const latest = toTaskResultFromEvent(e);
    if (!latest) continue;
    const seq = parseMetadataSequence(e.metadata);
    latest.subscription = {
      ...(latest.subscription || { isSubscription: true }),
      unsubscribeTaskId: sub.unsubscribeTaskId ?? latest.subscription?.unsubscribeTaskId,
      runCount: seq ?? latest.subscription?.runCount ?? sub.runCount,
    };
    const wall = eventWallClockMs(e) ?? latest.remoteUpdatedAtMs;
    const receivedAt = wall ?? Date.now();
    items.push({
      id: `em:${opts.taskId}:${seq ?? 'ns'}:${idx}`,
      receivedAt,
      baseUrl: b,
      taskId: opts.taskId,
      sequenceNumber: seq,
      isSubscription: true,
      unsubscribeTaskId: sub.unsubscribeTaskId,
      sessionId: latest.sessionId,
      status: latest.status,
      output: latest.output,
      error: latest.error,
      runCount: latest.subscription?.runCount,
    });
    idx += 1;
  }
  items.sort((a, b) => {
    const sa = a.sequenceNumber ?? 0;
    const sb = b.sequenceNumber ?? 0;
    if (sa !== sb) return sb - sa;
    return b.receivedAt - a.receivedAt;
  });
  return items.slice(1);
}

/**
 * Poll GetTask for each stored subscription and append new snapshots to the feed.
 * Subscription tasks stay `running` (WORKING) for most of their lifetime — we must not require a terminal state.
 */
export async function refreshSubscriptionFeedFromPolling(): Promise<void> {
  const subs = await readSubs();
  if (subs.length === 0) return;

  const [token, timeoutMs, retryCount] = await Promise.all([
    getA2aToken(),
    getA2aTimeoutMs(),
    getA2aRetryCount(),
  ]);
  const t = token?.trim() || null;

  let existing = await listSubscriptionFeedItems();

  for (const s of subs) {
    const rawBase = s.baseUrl?.trim();
    if (!rawBase) continue;
    const baseNorm = normalizeAgentBaseUrl(rawBase) || normBase(rawBase);
    try {
      const latest = await a2aService.getTaskOnce({
        config: { baseUrl: baseNorm, token: t, timeoutMs, retryCount },
        taskId: s.taskId,
        contextId: s.sessionId,
      });

      const sig = feedSignature(latest);
      const dup = existing.some((e) => e.taskId === latest.taskId && feedSignatureFromItem(e) === sig);
      if (dup) continue;

      const receivedAt = latest.remoteUpdatedAtMs ?? Date.now();
      const row: SubscriptionFeedItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        receivedAt,
        baseUrl: baseNorm,
        taskId: latest.taskId,
        sequenceNumber: latest.subscription?.runCount,
        isSubscription: true,
        unsubscribeTaskId: latest.subscription?.unsubscribeTaskId ?? s.unsubscribeTaskId,
        sessionId: latest.sessionId,
        status: latest.status,
        output: latest.output,
        error: latest.error,
        runCount: latest.subscription?.runCount ?? s.runCount,
      };

      existing = [row, ...existing].slice(0, MAX_ITEMS);
    } catch {
      // ignore per-sub errors
    }
  }

  await AsyncStorage.setItem(SUBSCRIPTION_FEED_STORAGE_KEY, JSON.stringify(existing));
  scheduleCloudA2aStatePush();
}

function relayEmissionsEndpointFromWebhook(webhookUrl: string): string | null {
  const trimmed = webhookUrl.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    // Supabase edge function route doubles as webhook + query endpoint.
    if (!u.pathname.includes('/functions/v1/')) {
      u.pathname = '/emissions';
      u.search = '';
    }
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchRelayEvents(relayEndpoint: string, taskId: string, since: number): Promise<A2AEvent[]> {
  const url = `${relayEndpoint}?taskId=${encodeURIComponent(taskId)}&since=${encodeURIComponent(String(since))}`;
  const bearer = (await getA2aTaskPushWebhookBearer()).trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const resp = await fetch(url, { method: 'GET', headers });
  if (!resp.ok) {
    await logA2aHop({
      level: 'error',
      hop: 'subsync.relay.fetch.error',
      status: 'failed',
      taskId,
      detail: { since, status: resp.status, endpoint: relayEndpoint },
    }).catch(() => {});
    return [];
  }
  const body = (await resp.json()) as RelayEventsResponse;
  const events = Array.isArray(body.events) ? body.events : [];
  await logA2aHop({
    level: 'info',
    hop: 'subsync.relay.fetch.ok',
    status: 'running',
    taskId,
    detail: { since, events: events.length },
  }).catch(() => {});
  return events;
}

export async function refreshSubscriptionFeed(taskId: string): Promise<void> {
  const [webhookUrl, subs] = await Promise.all([getA2aTaskPushWebhookUrl(), readSubs()]);
  const relayEndpoint = relayEmissionsEndpointFromWebhook(webhookUrl);
  if (!relayEndpoint) {
    await logA2aHop({
      level: 'error',
      hop: 'subsync.relay.endpoint.missing',
      status: 'failed',
      taskId,
    }).catch(() => {});
    return;
  }
  const sub = subs.find((s) => s.taskId === taskId || s.unsubscribeTaskId === taskId);
  if (!sub?.baseUrl?.trim()) {
    await logA2aHop({
      level: 'error',
      hop: 'subsync.sub.missing',
      status: 'failed',
      taskId,
      detail: { subsCount: subs.length },
    }).catch(() => {});
    return;
  }

  const lastSeen = await getLastSeenSequence(taskId);
  const overlapSince = Math.max(0, lastSeen - RELAY_SEQUENCE_OVERLAP);
  // eslint-disable-next-line no-console
  console.log('[SYNC] fetching task:', taskId, 'since:', overlapSince, 'lastSeen:', lastSeen);
  let events = await fetchRelayEvents(relayEndpoint, taskId, overlapSince);
  // If cursor drift happened (e.g. restore/offline edge), try one full replay pull.
  if (events.length === 0 && overlapSince > 0) {
    events = await fetchRelayEvents(relayEndpoint, taskId, 0);
  }
  // eslint-disable-next-line no-console
  console.log(
    '[SYNC] relay response for',
    taskId,
    '— count:',
    events.length,
    'events:',
    JSON.stringify(
      events.map((e) => parseMetadataSequence(e.metadata) ?? null)
    )
  );
  if (events.length === 0) return;

  const feedBefore = await listSubscriptionFeedItems();
  for (const e of events) {
    await storeEmission(e);
  }
  const all = await getEmissionsSince(taskId, 0);
  for (const e of all) {
    const latest = toTaskResultFromEvent(e);
    if (!latest) continue;
    const seq = parseMetadataSequence(e.metadata);
    latest.subscription = {
      ...(latest.subscription || { isSubscription: true }),
      unsubscribeTaskId: sub.unsubscribeTaskId,
      // Event sequence must win; tracked sub runCount is only a fallback.
      runCount: seq ?? latest.subscription?.runCount ?? sub.runCount,
    };
    const wall = eventWallClockMs(e) ?? latest.remoteUpdatedAtMs;
    await appendSubscriptionFeedItemFromTask(sub.baseUrl, latest, {
      wallClockMs: wall ?? undefined,
      sequenceNumber: seq,
    });
  }
  const feedAfter = await listSubscriptionFeedItems();
  const newRowCount = Math.max(0, feedAfter.length - feedBefore.length);
  // eslint-disable-next-line no-console
  console.log('[SYNC] feed updated for', taskId, '— new rows added:', newRowCount);
  await logA2aHop({
    level: 'info',
    hop: 'subsync.task.replayed',
    status: 'completed',
    taskId,
    detail: { replayedEvents: all.length, overlapSince, lastSeen },
  }).catch(() => {});
}

async function doRefreshAllActiveSubscriptionFeeds(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[SYNC] refresh triggered');
  let subs = await readSubs();
  // eslint-disable-next-line no-console
  console.log('[SYNC] tracked subs:', JSON.stringify(subs));
  await logA2aHop({
    level: 'info',
    hop: 'subsync.all.start',
    status: 'running',
    detail: { localSubs: subs.length },
  }).catch(() => {});
  const [baseUrl, token, timeoutMs, retryCount] = await Promise.all([
    getA2aBaseUrl(),
    getA2aToken(),
    getA2aTimeoutMs(),
    getA2aRetryCount(),
  ]);
  const base = (normalizeAgentBaseUrl(baseUrl) || normBase(baseUrl)).trim();
  if (base) {
    try {
      const tasks = await a2aService.listTasks({
        config: { baseUrl: base, token: token?.trim() || null, timeoutMs, retryCount },
      });
      const discovered = tasks
        .filter((t) => t.subscription?.isSubscription || !!t.subscription?.unsubscribeTaskId)
        .map(
          (t): SubRecord => ({
            taskId: t.taskId,
            unsubscribeTaskId: t.subscription?.unsubscribeTaskId ?? t.taskId,
            runCount: t.subscription?.runCount,
            baseUrl: base,
            sessionId: t.sessionId,
          })
        );
      subs = mergeSubRecords(subs, discovered);
      await writeSubs(subs);
      await logA2aHop({
        level: 'info',
        hop: 'subsync.listTasks.ok',
        status: 'running',
        detail: { discovered: discovered.length, mergedSubs: subs.length, baseUrl: base },
      }).catch(() => {});
    } catch {
      await logA2aHop({
        level: 'error',
        hop: 'subsync.listTasks.error',
        status: 'failed',
        detail: { baseUrl: base },
      }).catch(() => {});
      // keep existing subs from cloud / local track list
    }
  }
  await Promise.allSettled(subs.map((s) => refreshSubscriptionFeed(s.taskId)));
  // Fallback for missed webhook deliveries: always reconcile latest task state on sync.
  await refreshSubscriptionFeedFromPolling();
  scheduleCloudA2aStatePush();
  DeviceEventEmitter.emit(FRONTIER_A2A_TRACKING_STORAGE_UPDATED);
  requestA2aUiRefresh();
  await logA2aHop({
    level: 'info',
    hop: 'subsync.all.done',
    status: 'completed',
    detail: { syncedSubs: subs.length },
  }).catch(() => {});
}

export async function refreshAllActiveSubscriptionFeeds(): Promise<void> {
  if (refreshAllInFlight) return refreshAllInFlight;
  refreshAllInFlight = doRefreshAllActiveSubscriptionFeeds().finally(() => {
    refreshAllInFlight = null;
  });
  return refreshAllInFlight;
}

/** Pass task id and/or unsubscribe id — either match removes the row. */
export async function removeActiveSubscription(taskOrUnsubscribeId: string): Promise<void> {
  const subs = await readSubs();
  await writeSubs(
    subs.filter((x) => x.unsubscribeTaskId !== taskOrUnsubscribeId && x.taskId !== taskOrUnsubscribeId)
  );
}
