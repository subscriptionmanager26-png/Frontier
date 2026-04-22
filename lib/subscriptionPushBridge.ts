/**
 * Push-driven subscription refresh. Backend relays should dedupe webhook deliveries (e.g. by
 * artifactId / emission id) before persisting and forwarding to FCM — GetTask alone cannot
 * reconstruct full emission history. See lib/a2a/subscriptionConventions.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { a2aService } from '@/lib/a2a/service';
import type { A2aTaskResult } from '@/lib/a2a/types';
import { getA2aRetryCount, getA2aTimeoutMs, getA2aToken } from '@/lib/appSettings';
import { ACTIVE_SUBSCRIPTIONS_KEY } from '@/lib/a2aLocalStateKeys';
import { scheduleCloudA2aStatePush } from '@/lib/cloudA2aSyncScheduler';
import { appendSubscriptionFeedItemFromTask } from '@/lib/subscriptionUpdatesFeed';

export { ACTIVE_SUBSCRIPTIONS_KEY };

export type ActiveSubscriptionRecord = {
  unsubscribeTaskId?: string;
  taskId: string;
  runCount?: number;
  /** Required for routing push refreshes to Direct (and GetTask). */
  baseUrl?: string;
  sessionId?: string;
};

export type SubscriptionPushEvent = A2aTaskResult;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

type Handler = (evt: SubscriptionPushEvent) => void;

const handlersByBase = new Map<string, Set<Handler>>();

/**
 * Direct and user-agent chat screens register here so subscription-related pushes can
 * update the assistant row for the matching resolved A2A base URL.
 */
export function registerDirectSubscriptionPushHandler(agentUrl: string, handler: Handler): () => void {
  const key = normalizeBaseUrl(agentUrl);
  if (!key) return () => {};
  let set = handlersByBase.get(key);
  if (!set) {
    set = new Set();
    handlersByBase.set(key, set);
  }
  set.add(handler);
  return () => {
    const s = handlersByBase.get(key);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) handlersByBase.delete(key);
  };
}

function emitForBase(baseUrl: string, evt: SubscriptionPushEvent): void {
  const key = normalizeBaseUrl(baseUrl);
  const set = handlersByBase.get(key);
  if (!set) return;
  for (const h of set) {
    try {
      h(evt);
    } catch {
      // Never break other handlers.
    }
  }
}

async function readSubs(): Promise<ActiveSubscriptionRecord[]> {
  const raw = await AsyncStorage.getItem(ACTIVE_SUBSCRIPTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ActiveSubscriptionRecord[];
    return Array.isArray(parsed) ? parsed.filter((x) => x?.taskId && x?.baseUrl) : [];
  } catch {
    return [];
  }
}

async function writeSubs(subs: ActiveSubscriptionRecord[]): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_SUBSCRIPTIONS_KEY, JSON.stringify(subs));
  scheduleCloudA2aStatePush();
}

function pickMatchingSub(
  subs: ActiveSubscriptionRecord[],
  taskId: string,
  unsubscribeTaskIdFromPush: string | null
): ActiveSubscriptionRecord | null {
  if (unsubscribeTaskIdFromPush) {
    const byUnsub = subs.find((s) => s.unsubscribeTaskId === unsubscribeTaskIdFromPush);
    if (byUnsub) return byUnsub;
  }
  return subs.find((s) => s.taskId === taskId || s.unsubscribeTaskId === taskId) ?? null;
}

function readPushRoutingFields(data: Record<string, unknown>): {
  taskId: string | null;
  baseUrlHint: string | null;
  unsubscribeTaskIdFromPush: string | null;
  contextFromPush: string | undefined;
} {
  const taskId = typeof data.taskId === 'string' ? data.taskId : null;
  const baseUrlHint =
    typeof data.baseUrl === 'string' && data.baseUrl.trim()
      ? data.baseUrl.trim()
      : typeof data.agentUrl === 'string' && data.agentUrl.trim()
        ? data.agentUrl.trim()
        : null;
  const unsubscribeTaskIdFromPush =
    typeof data.unsubscribeTaskId === 'string' && data.unsubscribeTaskId.trim()
      ? data.unsubscribeTaskId.trim()
      : null;
  const contextFromPush =
    typeof data.contextId === 'string' && data.contextId.trim()
      ? data.contextId.trim()
      : typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : undefined;
  return { taskId, baseUrlHint, unsubscribeTaskIdFromPush, contextFromPush };
}

type ResolvePushResult = {
  latest: A2aTaskResult;
  matched: ActiveSubscriptionRecord | null;
  baseUrl: string;
  subs: ActiveSubscriptionRecord[];
};

async function resolveA2aTaskFromNotificationData(data: Record<string, unknown>): Promise<ResolvePushResult | null> {
  const { taskId, baseUrlHint, unsubscribeTaskIdFromPush, contextFromPush } = readPushRoutingFields(data);
  if (!taskId) return null;

  const subs = await readSubs();
  const matched = pickMatchingSub(subs, taskId, unsubscribeTaskIdFromPush);
  const baseUrl = matched?.baseUrl?.trim() || baseUrlHint?.trim();
  if (!baseUrl) return null;

  const [token, timeoutMs, retryCount] = await Promise.all([
    getA2aToken(),
    getA2aTimeoutMs(),
    getA2aRetryCount(),
  ]);

  try {
    const latest = await a2aService.getTaskOnce({
      config: { baseUrl: normalizeBaseUrl(baseUrl), token: token?.trim() || null, timeoutMs, retryCount },
      taskId,
      contextId: matched?.sessionId || contextFromPush,
    });
    return { latest, matched, baseUrl, subs };
  } catch {
    return null;
  }
}

/**
 * Load current task state for in-app notification detail (subscription or any push that
 * includes taskId + baseUrl or a matching stored subscription).
 */
export async function fetchTaskForNotificationDetail(data: Record<string, unknown>) {
  return resolveA2aTaskFromNotificationData(data);
}

/**
 * Called from a single app-level notification listener. If the push references a task
 * tied to a stored subscription (and we know the agent base URL), polls GetTask and
 * notifies Direct handlers for that base.
 */
export async function processSubscriptionPushNotification(data: Record<string, unknown>): Promise<void> {
  const resolved = await resolveA2aTaskFromNotificationData(data);
  if (!resolved) return;
  const { latest, matched, baseUrl, subs } = resolved;
  if (!baseUrl?.trim()) return;

  const subMeta = latest.subscription;
  const liveSubscription = subMeta?.isSubscription === true && !!subMeta.unsubscribeTaskId;
  /** Push payloads often omit agent base URL; we only reach here if `matched` or baseUrlHint supplied a URL. */
  const runningMatchedSubscription =
    Boolean(matched?.unsubscribeTaskId) && latest.status === 'running';

  if (matched && (liveSubscription || runningMatchedSubscription)) {
    const unsubId = subMeta?.unsubscribeTaskId ?? matched!.unsubscribeTaskId;
    const nextSubs = subs.map((s) =>
      s.unsubscribeTaskId === unsubId
        ? {
            ...s,
            baseUrl: s.baseUrl || normalizeBaseUrl(baseUrl),
            taskId: latest.taskId,
            sessionId: latest.sessionId || s.sessionId,
            runCount: subMeta?.runCount ?? s.runCount,
          }
        : s
    );
    await writeSubs(nextSubs);
  }

  const terminal =
    latest.status === 'completed' ||
    latest.status === 'failed' ||
    latest.status === 'input_required' ||
    latest.status === 'auth_required' ||
    latest.status === 'cancelled';

  /**
   * Running subscription ticks need UI refresh; other running tasks stay quiet unless this push
   * matched a row in activeSubscriptions (Expo data has taskId but not always subscription metadata from GetTask).
   */
  if (!terminal && !liveSubscription && !runningMatchedSubscription) return;

  const latestForFeed: A2aTaskResult =
    !latest.subscription?.unsubscribeTaskId && matched?.unsubscribeTaskId
      ? {
          ...latest,
          subscription: {
            isSubscription: true,
            unsubscribeTaskId: matched.unsubscribeTaskId,
            runCount: latest.subscription?.runCount ?? matched.runCount,
            interval: latest.subscription?.interval,
            nextEmissionAt: latest.subscription?.nextEmissionAt,
            cadenceMs: latest.subscription?.cadenceMs,
            startedAt: latest.subscription?.startedAt,
            endsAt: latest.subscription?.endsAt,
          },
        }
      : latest;

  /**
   * Record snapshots (deduped). Includes recurring subscription ticks while still running.
   */
  await appendSubscriptionFeedItemFromTask(baseUrl, latestForFeed);
  emitForBase(baseUrl, latestForFeed);
}
