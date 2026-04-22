import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, Platform } from 'react-native';

import { FRONTIER_A2A_UI_REFRESH } from '@/lib/a2aUiRefreshBus';
import { useAuth } from '@/contexts/AuthContext';
import { callAgent, type AgentTurn } from '@/lib/agent/client';
import type { RenderedComponent } from '@/lib/agent/tools';
import { classifyAgentPayload } from '@/lib/dslUi';
import {
  getA2aBaseUrl,
  getA2aRetryCount,
  getA2aTimeoutMs,
  getA2aToken,
  getAnthropicKey,
  getAzureChatCompletionsUrl,
  getAzureOpenAiKey,
  getOpenAiKey,
  getOpenAiModel,
} from '@/lib/appSettings';
import { directMessageThreadId, legacyDirectMessageThreadId } from '@/lib/directMessageThreadId';
import { canonicalA2aAgentUrl } from '@/lib/a2a/store';
import { a2aService } from '@/lib/a2a/service';
import type { A2aTaskResult } from '@/lib/a2a/types';
import { runMcpOAuthForBaseUrl } from '@/lib/mcpOAuth';
import { getCurrentExpoPushToken } from '@/lib/notifications';
import { scheduleCloudA2aStatePush } from '@/lib/cloudA2aSyncScheduler';
import { dismissAgentInboundBySenderRpcUrl } from '@/lib/agentInbound';
import {
  ACTIVE_SUBSCRIPTIONS_KEY,
  type ActiveSubscriptionRecord,
} from '@/lib/subscriptionPushBridge';
import {
  appendSubscriptionFeedItemFromTask,
  comparableSubscriptionAgentBase,
  filterSubscriptionFeedForAgent,
  FRONTIER_A2A_TRACKING_STORAGE_UPDATED,
  listSubscriptionFeedItems,
  trackTaskForUpdates,
} from '@/lib/subscriptionUpdatesFeed';
import { fetchDirectMessageEvents, insertClientPairFromA2aTurn } from '@/lib/directMessageEvents';
import {
  deleteThreadFromStorage,
  loadMessagesFromStorage,
  messagesStorageKey,
  saveMessagesToStorage,
} from '@/lib/agentMessagesStorage';
import { supabase } from '@/lib/supabase';
import { orderedChainFromLeaf, threadRootIdForMessage } from '@/lib/threadMessages';
import { getUserAgent } from '@/lib/userAgents';

/** Serial for Realtime topic names — must not reset on Strict Mode remount (unlike `useRef`). */
let directMessageRealtimeTopicSerial = 0;

function uniqueDirectMessageRealtimeTopic(threadSlug: string): string {
  directMessageRealtimeTopicSerial += 1;
  return `dme-${directMessageRealtimeTopicSerial}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${threadSlug}`.slice(0, 120);
}

/** Text for in-thread rows when `processSubscriptionPushNotification` delivers GetTask snapshots. */
function assistantTextFromSubscriptionPushSnapshot(latest: A2aTaskResult): string {
  if (latest.status === 'completed') {
    return latest.output || 'Remote agent completed.';
  }
  if (
    latest.status === 'running' &&
    latest.subscription?.isSubscription &&
    latest.subscription.unsubscribeTaskId
  ) {
    return latest.output ?? '';
  }
  if (latest.status === 'input_required' || latest.status === 'auth_required') {
    return latest.output || 'Remote agent requires more input to continue this task.';
  }
  if (latest.status === 'failed' || latest.status === 'cancelled') {
    return `A2A failed: ${latest.error || 'Unknown remote error'}`;
  }
  return latest.output ?? '';
}

function appendTerminalTaskToSubscriptionFeed(baseUrl: string, latest: A2aTaskResult): void {
  const t = latest.status;
  if (
    t !== 'completed' &&
    t !== 'failed' &&
    t !== 'input_required' &&
    t !== 'auth_required' &&
    t !== 'cancelled'
  ) {
    return;
  }
  if (!baseUrl.trim()) return;
  void appendSubscriptionFeedItemFromTask(baseUrl, latest);
}

function normalizeSubscriptionChatText(args: {
  status: string;
  output?: string;
  error?: string;
}): string {
  if (args.error?.trim()) return `A2A failed: ${args.error.trim()}`;
  if (args.output?.trim()) return args.output.trim();
  if (args.status === 'completed') return 'Remote agent completed.';
  if (args.status === 'failed' || args.status === 'cancelled') return 'A2A failed: Unknown remote error';
  if (args.status === 'input_required' || args.status === 'auth_required') {
    return 'Remote agent requires more input to continue this task.';
  }
  return '';
}

function preferFresherMessage(a: AgentUiMessage, b: AgentUiMessage): AgentUiMessage {
  const aWorking = a.text.trim().toLowerCase() === 'working...';
  const bWorking = b.text.trim().toLowerCase() === 'working...';
  if (aWorking !== bWorking) return aWorking ? b : a;
  if ((b.text?.length ?? 0) > (a.text?.length ?? 0)) return b;
  return a;
}

function mergeMessagesPreferFresh(prev: AgentUiMessage[], loaded: AgentUiMessage[]): AgentUiMessage[] {
  if (loaded.length === 0) return prev;
  if (prev.length === 0) return loaded;
  const byId = new Map<string, AgentUiMessage>();
  for (const m of loaded) byId.set(m.id, m);
  for (const m of prev) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing ? preferFresherMessage(existing, m) : m);
  }
  // Preserve current ordering feel: keep previous order, append any unseen loaded rows.
  const seen = new Set<string>();
  const merged: AgentUiMessage[] = [];
  for (const m of prev) {
    const picked = byId.get(m.id);
    if (!picked || seen.has(picked.id)) continue;
    merged.push(picked);
    seen.add(picked.id);
  }
  for (const m of loaded) {
    if (seen.has(m.id)) continue;
    const picked = byId.get(m.id) ?? m;
    merged.push(picked);
    seen.add(m.id);
  }
  return merged;
}

export type AgentUiMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /**
   * UI-only: parent message id for nested display in the hub (not an A2A wire field).
   * A2A uses `contextId` + `referenceTaskIds` on `Message` for protocol semantics.
   */
  replyToId?: string | null;
  /** A2A v1 `Message.contextId` when known (same across turns in one conversation). */
  contextId?: string | null;
  /** A2A v1 `Message.referenceTaskIds` when known. */
  referenceTaskIds?: string[];
  /** A2A v1 `Message.messageId` when known. */
  a2aMessageId?: string | null;
  components?: RenderedComponent[];
  taskId?: string;
  traceId?: string;
  subscription?: { unsubscribeTaskId?: string; runCount?: number };
  /** Matches agent subscription emission index (runCount / emission_count) for this task. */
  subscriptionEmissionRunCount?: number;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const A2A_OAUTH_TOKEN_BY_BASE_KEY = 'frontier_a2a_oauth_token_by_base_v1';

function normalizeIncomingAssistantText(raw: string, dslEnabled: boolean): string {
  const classified = classifyAgentPayload(raw);
  if (classified.kind === 'text_json') return classified.content;
  if (classified.kind === 'dsl' && !dslEnabled) return raw;
  if (classified.kind === 'plain') return classified.content;
  return raw;
}

async function getCachedA2aOauthToken(baseUrl: string): Promise<string | null> {
  const key = baseUrl.trim().replace(/\/+$/, '');
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(A2A_OAUTH_TOKEN_BY_BASE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    const token = map[key];
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

async function setCachedA2aOauthToken(baseUrl: string, token: string): Promise<void> {
  const key = baseUrl.trim().replace(/\/+$/, '');
  if (!key || !token.trim()) return;
  let map: Record<string, string> = {};
  try {
    const raw = await AsyncStorage.getItem(A2A_OAUTH_TOKEN_BY_BASE_KEY);
    map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    map = {};
  }
  map[key] = token.trim();
  await AsyncStorage.setItem(A2A_OAUTH_TOKEN_BY_BASE_KEY, JSON.stringify(map));
}

function toUserFacingA2aError(err: string): string {
  const e = err.toLowerCase();
  if (e.includes('versionnotsupportederror') || e.includes('incompatible protocol version')) {
    return 'A2A failed: Version not supported by remote agent.';
  }
  if (e.includes('tasknotfounderror')) return 'A2A failed: Task not found on remote agent.';
  if (e.includes('tasknotcancelableerror')) return 'A2A failed: Task is already terminal and cannot be cancelled.';
  if (e.includes('unsupportedoperationerror')) return 'A2A failed: Operation is unsupported for current task state.';
  if (e.includes('invalid params') || e.includes('-32602')) return 'A2A failed: Invalid parameters sent to remote agent.';
  return `A2A failed: ${err}`;
}

function isSluglessGatewayTarget(baseUrl: string): boolean {
  const t = baseUrl.trim().replace(/\/+$/, '');
  if (!t) return true;
  return /\/functions\/v1\/a2a-gateway$/i.test(t) || /\/a2a\/v1$/i.test(t);
}

function inferOAuthBaseUrl(authUrl?: string): string | null {
  if (!authUrl) return null;
  try {
    const u = new URL(authUrl);
    if (u.pathname.endsWith('/authorize')) {
      u.pathname = u.pathname.slice(0, -'/authorize'.length);
      return u.toString().replace(/\/+$/, '');
    }
    return `${u.origin}/mcp`;
  } catch {
    return null;
  }
}

export type AgentChatScope =
  | { kind: 'default' }
  | { kind: 'userAgent'; userAgentId: string }
  | { kind: 'direct'; agentUrl: string };

type ActiveA2aTask = {
  taskId: string;
  sessionId?: string;
  messageId: string;
  baseUrl: string;
};

export function useAgent(scope: AgentChatScope = { kind: 'default' }) {
  const { session } = useAuth();
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<AgentUiMessage[]>([]);
  /** False until AsyncStorage load for this threadId finishes — avoids overwriting saved data with []. */
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [remoteState, setRemoteState] = useState<'idle' | 'connecting' | 'connected' | 'running' | 'completed' | 'failed'>('idle');
  const [dslEnabledByAgent, setDslEnabledByAgent] = useState<Record<string, boolean>>({});
  const [currentAgentBaseUrl, setCurrentAgentBaseUrl] = useState('');
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscriptionRecord[]>([]);
  const [activeSubscriptionsHydrated, setActiveSubscriptionsHydrated] = useState(false);
  const upsertActiveSubscription = useCallback((record: ActiveSubscriptionRecord) => {
    const taskId = record.taskId?.trim();
    const baseUrl = record.baseUrl?.trim();
    if (!taskId || !baseUrl) return;
    const unsubId = record.unsubscribeTaskId?.trim() || undefined;
    setActiveSubscriptions((prev) => {
      const existingByTask = prev.find((x) => x.taskId === taskId);
      const merged: ActiveSubscriptionRecord = {
        ...existingByTask,
        ...record,
        taskId,
        baseUrl,
        unsubscribeTaskId: unsubId || existingByTask?.unsubscribeTaskId,
      };
      return [
        ...prev.filter(
          (x) => x.taskId !== taskId && (!merged.unsubscribeTaskId || x.unsubscribeTaskId !== merged.unsubscribeTaskId)
        ),
        merged,
      ];
    });
  }, []);

  const activeTaskRef = useRef<ActiveA2aTask | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const capabilitiesCheckedRef = useRef<Record<string, true>>({});
  const threadId = useMemo(() => {
    const uid = session?.user?.id ?? null;
    const userScope = uid ? `u-${uid}` : 'u-guest';
    if (scope.kind === 'default') return `${userScope}:frontier-ui-default-thread`;
    if (scope.kind === 'userAgent') return `${userScope}:frontier-ui-user-${scope.userAgentId}`;
    /** Same key as Requests seed + `pickUrl` on `/direct/agent` (decoded param + canonical base). */
    return directMessageThreadId(uid, scope.agentUrl);
  }, [
    session?.user?.id,
    scope.kind,
    scope.kind === 'userAgent' ? scope.userAgentId : '',
    scope.kind === 'direct' ? scope.agentUrl : '',
  ]);

  const resolveScopeBaseUrl = useCallback(async (): Promise<string> => {
    /** Same string family as threadId + session map (canonical), so A2A traffic and storage agree. */
    if (scope.kind === 'direct') {
      const out = canonicalA2aAgentUrl(scope.agentUrl);
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H1-H3',location:'hooks/useAgent.ts:resolveScopeBaseUrl',message:'resolved direct scope base',data:{scopeKind:'direct',inputUrl:scope.agentUrl,resolvedBase:out},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return out;
    }
    if (scope.kind === 'userAgent') {
      const agent = await getUserAgent(scope.userAgentId);
      const o = agent?.baseUrlOverride?.trim();
      if (o) {
        const out = o.replace(/\/+$/, '');
        // #region agent log
        fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H2',location:'hooks/useAgent.ts:resolveScopeBaseUrl',message:'resolved userAgent override base',data:{scopeKind:'userAgent',resolvedBase:out,hasOverride:true},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return out;
      }
      const out = (await getA2aBaseUrl()).trim().replace(/\/+$/, '');
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H2-H5',location:'hooks/useAgent.ts:resolveScopeBaseUrl',message:'resolved userAgent default base',data:{scopeKind:'userAgent',resolvedBase:out,hasOverride:false},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return out;
    }
    const out = (await getA2aBaseUrl()).trim().replace(/\/+$/, '');
    // #region agent log
    fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H2-H5',location:'hooks/useAgent.ts:resolveScopeBaseUrl',message:'resolved default scope base',data:{scopeKind:scope.kind,resolvedBase:out},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return out;
  }, [scope]);

  const trackTaskUpdates = useCallback(
    async (taskId: string, sessionId?: string) => {
      const base = (await resolveScopeBaseUrl()).trim().replace(/\/+$/, '');
      if (!taskId.trim() || !base) return;
      const next: ActiveSubscriptionRecord = {
        taskId: taskId.trim(),
        baseUrl: base,
        sessionId: sessionId?.trim() || undefined,
      };
      upsertActiveSubscription(next);
      await trackTaskForUpdates(next);
    },
    [resolveScopeBaseUrl, upsertActiveSubscription]
  );

  const reconcileChatFromSubscriptionFeed = useCallback(async () => {
    const base = (await resolveScopeBaseUrl()).trim();
    if (!base) return;
    const all = await listSubscriptionFeedItems();
    const scoped = filterSubscriptionFeedForAgent(base, all)
      .slice()
      .sort((a, b) => a.receivedAt - b.receivedAt);
    if (scoped.length === 0) return;

    const baseKey = comparableSubscriptionAgentBase(base);
    setMessages((prev) => {
      let next = prev;
      for (const row of scoped) {
        const rowText = normalizeIncomingAssistantText(
          normalizeSubscriptionChatText({
            status: row.status,
            output: row.output,
            error: row.error,
          }),
          dslEnabled
        );
        if (!rowText) continue;
        const dupBySeq = next.some(
          (m) => m.taskId === row.taskId && typeof row.sequenceNumber === 'number' && m.subscriptionEmissionRunCount === row.sequenceNumber
        );
        const dupByText = next.some(
          (m) =>
            m.taskId === row.taskId &&
            m.role === 'assistant' &&
            m.text.trim() === rowText &&
            comparableSubscriptionAgentBase(row.baseUrl) === baseKey
        );
        if (dupBySeq || dupByText) continue;

        const anchor = [...next]
          .reverse()
          .find((m) => m.taskId === row.taskId && m.role === 'assistant');
        const isTerminal =
          row.status === 'completed' ||
          row.status === 'failed' ||
          row.status === 'input_required' ||
          row.status === 'auth_required' ||
          row.status === 'cancelled';
        if (isTerminal && anchor && anchor.text.trim().toLowerCase() === 'working...') {
          next = next.map((m) =>
            m.id === anchor.id
              ? {
                  ...m,
                  text: rowText,
                  traceId: m.traceId,
                  subscription:
                    row.isSubscription || row.unsubscribeTaskId
                      ? { unsubscribeTaskId: row.unsubscribeTaskId, runCount: row.runCount }
                      : undefined,
                  subscriptionEmissionRunCount: row.sequenceNumber ?? row.runCount,
                }
              : m
          );
          continue;
        }
        next = [
          ...next,
          {
            id: newId(),
            role: 'assistant',
            text: rowText,
            replyToId: anchor?.id || undefined,
            taskId: row.taskId,
            subscription:
              row.isSubscription || row.unsubscribeTaskId
                ? { unsubscribeTaskId: row.unsubscribeTaskId, runCount: row.runCount }
                : undefined,
            subscriptionEmissionRunCount: row.sequenceNumber ?? row.runCount,
          },
        ];
      }
      return next;
    });
  }, [resolveScopeBaseUrl, dslEnabled]);

  const dslEnabled = useMemo(
    () => dslEnabledByAgent[currentAgentBaseUrl.trim().replace(/\/+$/, '')] ?? false,
    [currentAgentBaseUrl, dslEnabledByAgent]
  );

  const streamAssistantText = useCallback(async (messageId: string, fullText: string) => {
    const lines = fullText.split('\n');
    let acc = '';
    for (const line of lines) {
      acc = acc ? `${acc}\n${line}` : line;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, text: acc } : m)));
      // Line-based progressive updates for DSL/text payloads.
      await new Promise((r) => setTimeout(r, 45));
    }
  }, []);

  const reloadTrackedSubscriptions = useCallback(async () => {
    const raw = await AsyncStorage.getItem(ACTIVE_SUBSCRIPTIONS_KEY);
    if (!raw) {
      setActiveSubscriptions([]);
      setActiveSubscriptionsHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ActiveSubscriptionRecord[];
      setActiveSubscriptions(parsed.filter((x) => !!x.taskId && !!x.baseUrl));
    } catch {
      setActiveSubscriptions([]);
    }
    setActiveSubscriptionsHydrated(true);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    void reloadTrackedSubscriptions();
  }, [session?.user?.id, reloadTrackedSubscriptions]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_UI_REFRESH, () => {
      if (!messagesHydrated) return;
      void (async () => {
        const loaded = await loadMessagesFromStorage(threadId);
        if (!loaded?.length) return;
        setMessages((prev) => mergeMessagesPreferFresh(prev, loaded));
        await reconcileChatFromSubscriptionFeed();
      })();
    });
    return () => sub.remove();
  }, [threadId, messagesHydrated, reconcileChatFromSubscriptionFeed]);

  useEffect(() => {
    if (!messagesHydrated) return;
    void reconcileChatFromSubscriptionFeed();
  }, [messagesHydrated, reconcileChatFromSubscriptionFeed]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_TRACKING_STORAGE_UPDATED, () => {
      void reloadTrackedSubscriptions();
    });
    return () => sub.remove();
  }, [reloadTrackedSubscriptions]);

  useEffect(() => {
    if (!activeSubscriptionsHydrated) return;
    void AsyncStorage.setItem(ACTIVE_SUBSCRIPTIONS_KEY, JSON.stringify(activeSubscriptions));
    scheduleCloudA2aStatePush();
  }, [activeSubscriptions, activeSubscriptionsHydrated]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener((evt) => {
      const data = (evt.request.content.data ?? {}) as Record<string, unknown>;
      const taskId = typeof data.taskId === 'string' ? data.taskId : null;
      if (!taskId) return;
      const running = activeTaskRef.current;
      const tracked = activeSubscriptions.find((s) => s.taskId === taskId || s.unsubscribeTaskId === taskId);
      if ((!running || running.taskId !== taskId) && !tracked) return;
      void (async () => {
        const a2aUrl = (running?.baseUrl || tracked?.baseUrl || '').trim();
        const [a2aToken, timeoutMs, retryCount] = await Promise.all([
          getA2aToken(),
          getA2aTimeoutMs(),
          getA2aRetryCount(),
        ]);
        if (!a2aUrl.trim()) return;
        const latest = await a2aService.getTaskOnce({
          config: { baseUrl: a2aUrl.trim(), token: a2aToken?.trim() || null, timeoutMs, retryCount },
          taskId,
          contextId: running?.sessionId || tracked?.sessionId,
        });
        await trackTaskForUpdates({
          taskId: latest.taskId,
          baseUrl: a2aUrl.trim().replace(/\/+$/, ''),
          sessionId: latest.sessionId || tracked?.sessionId,
          unsubscribeTaskId: latest.subscription?.unsubscribeTaskId || tracked?.unsubscribeTaskId,
          runCount: latest.subscription?.runCount ?? tracked?.runCount,
        });
        if (latest.status === 'running' && latest.output?.trim()) {
          setMessages((prev) => {
            const anchor = [...prev]
              .reverse()
              .find((m) => m.taskId === latest.taskId && m.role === 'assistant');
            const anchorId = anchor?.id || running?.messageId || null;
            const duplicate = anchor && anchor.text.trim() === latest.output!.trim();
            if (!anchorId || duplicate) return prev;
            return [
              ...prev,
              {
                id: newId(),
                role: 'assistant',
                text: normalizeIncomingAssistantText(latest.output || '', dslEnabled),
                replyToId: anchorId,
                taskId: latest.taskId,
                traceId: latest.traceId,
                subscription: latest.subscription?.isSubscription
                  ? {
                      unsubscribeTaskId: latest.subscription.unsubscribeTaskId,
                      runCount: latest.subscription.runCount,
                    }
                  : undefined,
                subscriptionEmissionRunCount:
                  typeof latest.subscription?.runCount === 'number' ? latest.subscription.runCount : undefined,
              },
            ];
          });
          await appendSubscriptionFeedItemFromTask(a2aUrl, latest);
          return;
        }
        if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'input_required' || latest.status === 'auth_required' || latest.status === 'cancelled') {
          const rawText = latest.status === 'completed' ? latest.output || 'Remote agent completed.' : `A2A failed: ${latest.error || 'Unknown remote error'}`;
          const text = normalizeIncomingAssistantText(rawText, dslEnabled);
          if (running?.messageId) {
            setMessages((ms) => ms.map((m) => (m.id === running.messageId ? { ...m, text, taskId: latest.taskId, traceId: latest.traceId, subscription: latest.subscription?.isSubscription ? { unsubscribeTaskId: latest.subscription.unsubscribeTaskId, runCount: latest.subscription.runCount } : undefined } : m)));
          }
          if (latest.subscription?.isSubscription && latest.subscription.unsubscribeTaskId) {
            const b = a2aUrl.trim().replace(/\/+$/, '');
            upsertActiveSubscription({
              unsubscribeTaskId: latest.subscription.unsubscribeTaskId,
              taskId: latest.taskId,
              runCount: latest.subscription.runCount,
              baseUrl: b,
              sessionId: latest.sessionId,
            });
          }
          appendTerminalTaskToSubscriptionFeed(a2aUrl, latest);
          setRemoteState(latest.status === 'completed' ? 'completed' : latest.status === 'input_required' || latest.status === 'auth_required' ? 'running' : 'failed');
          if (running?.taskId === taskId) activeTaskRef.current = null;
        }
      })();
    });
    return () => sub.remove();
  }, [dslEnabled, upsertActiveSubscription, activeSubscriptions]);

  const ensureRemoteCapabilities = useCallback(async () => {
    const [baseUrl, token, timeoutMs, retryCount] = await Promise.all([
      resolveScopeBaseUrl(),
      getA2aToken(),
      getA2aTimeoutMs(),
      getA2aRetryCount(),
    ]);
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (!base) return;
    setCurrentAgentBaseUrl(base);
    if (capabilitiesCheckedRef.current[base]) return;
    const pushToken = await getCurrentExpoPushToken();
    const res = await a2aService.connect({
      baseUrl: base,
      token: token?.trim() || null,
      timeoutMs,
      retryCount,
      pushChannel: 'expo',
      pushToken,
    });
    if (res.ok) {
      capabilitiesCheckedRef.current[base] = true;
      const tags = res.metadata.tags ?? [];
      setDslEnabledByAgent((prev) => ({
        ...prev,
        [base]: tags.includes('custom-ui') || tags.includes('dsl'),
      }));
    }
  }, [resolveScopeBaseUrl]);

  const connectRemote = useCallback(async () => {
    const [baseUrl, token, timeoutMs, retryCount] = await Promise.all([
      resolveScopeBaseUrl(),
      getA2aToken(),
      getA2aTimeoutMs(),
      getA2aRetryCount(),
    ]);
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (!base) return { ok: false as const, error: 'A2A base URL is not set in Settings.' };
    setCurrentAgentBaseUrl(base);
    setRemoteState('connecting');
    const pushToken = await getCurrentExpoPushToken();
    const res = await a2aService.connect({ baseUrl: base, token: token?.trim() || null, timeoutMs, retryCount, pushChannel: 'expo', pushToken });
    if (res.ok) {
      capabilitiesCheckedRef.current[base] = true;
      const tags = res.metadata.tags ?? [];
      setDslEnabledByAgent((prev) => ({
        ...prev,
        [base]: tags.includes('custom-ui') || tags.includes('dsl'),
      }));
    }
    setRemoteState(res.ok ? 'connected' : 'failed');
    return res;
  }, [resolveScopeBaseUrl]);

  useEffect(() => {
    void ensureRemoteCapabilities();
  }, [ensureRemoteCapabilities, threadId]);

  useLayoutEffect(() => {
    let cancelled = false;
    activeTaskRef.current = null;
    setRemoteState('idle');
    setMessagesHydrated(false);
    setMessages([]);
    void (async () => {
      let loaded = await loadMessagesFromStorage(threadId);
      if (
        !cancelled &&
        session?.user?.id &&
        (scope.kind === 'direct' || scope.kind === 'userAgent')
      ) {
        const remote = await fetchDirectMessageEvents(threadId);
        if (remote.length > 0) {
          loaded = remote as AgentUiMessage[];
          await saveMessagesToStorage(threadId, loaded);
        }
      }
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix-3',hypothesisId:'H11-H12',location:'hooks/useAgent.ts:hydrate',message:'loaded messages for thread',data:{scopeKind:scope.kind,threadId,loadedCount:Array.isArray(loaded)?loaded.length:0},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (
        !cancelled &&
        scope.kind === 'direct' &&
        (!loaded || loaded.length === 0)
      ) {
        const legacyThreadId = legacyDirectMessageThreadId(session?.user?.id ?? null, scope.agentUrl);
        if (legacyThreadId !== threadId) {
          const legacyLoaded = await loadMessagesFromStorage(legacyThreadId);
          // #region agent log
          fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix-3',hypothesisId:'H12',location:'hooks/useAgent.ts:hydrate',message:'checked legacy direct thread key',data:{threadId,legacyThreadId,legacyCount:Array.isArray(legacyLoaded)?legacyLoaded.length:0},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (legacyLoaded && legacyLoaded.length > 0) {
            await saveMessagesToStorage(threadId, legacyLoaded);
            try {
              await AsyncStorage.removeItem(messagesStorageKey(legacyThreadId));
            } catch {
              // ignore
            }
            loaded = legacyLoaded;
          }
        }
      }
      if (cancelled) return;
      if (loaded && loaded.length > 0) {
        setMessages(loaded);
      }
      // Defer hydration until after React applies `setMessages`, so the save effect does not persist [] over migrated rows.
      queueMicrotask(() => {
        if (!cancelled) setMessagesHydrated(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    threadId,
    scope.kind,
    scope.kind === 'direct' ? scope.agentUrl : '',
    scope.kind === 'userAgent' ? scope.userAgentId : '',
    session?.user?.id,
  ]);

  useEffect(() => {
    if (!messagesHydrated || !session?.user?.id) return;
    if (scope.kind !== 'direct' && scope.kind !== 'userAgent') return;
    if (!supabase) return;
    const uid = session.user.id;
    const threadSlug = threadId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    const topic = uniqueDirectMessageRealtimeTopic(threadSlug);
    const ch = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_message_events',
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as { thread_id?: string };
          if (row.thread_id !== threadId) return;
          void (async () => {
            const remote = await fetchDirectMessageEvents(threadId);
            if (remote.length > 0) {
              setMessages(remote as AgentUiMessage[]);
              await saveMessagesToStorage(threadId, remote as AgentUiMessage[]);
            }
          })();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [messagesHydrated, session?.user?.id, threadId, scope.kind]);

  useEffect(() => {
    if (!messagesHydrated) return;
    const t = setTimeout(() => {
      void (async () => {
        /** Avoid persisting [] over inbound seed / storage that landed same tick as hub mount. */
        if (scope.kind === 'direct' && messages.length === 0) {
          const disk = await loadMessagesFromStorage(threadId);
          if (disk && disk.length > 0) {
            setMessages(disk);
            return;
          }
        }
        void saveMessagesToStorage(threadId, messages);
      })();
    }, 200);
    return () => clearTimeout(t);
  }, [messages, threadId, messagesHydrated, scope.kind]);

  useEffect(() => {
    return () => {
      void saveMessagesToStorage(threadId, messagesRef.current);
    };
  }, [threadId]);

  const send = useCallback(
    async (text: string, replyToId?: string | null) => {
    const userText = text.trim();
    if (!userText || sending) return;
    setSending(true);
    const validReply =
      replyToId && messages.some((m) => m.id === replyToId) ? replyToId : undefined;
    const userUi: AgentUiMessage = {
      id: newId(),
      role: 'user',
      text: userText,
      replyToId: validReply ?? undefined,
    };
    const combinedAfterUser = [...messages, userUi];
    const nextTurns = orderedChainFromLeaf(combinedAfterUser, userUi.id).map((m) => ({
      role: m.role,
      text: m.text,
    })) as AgentTurn[];
    /** Direct hub shares one message store per agent; A2A session must be per UI thread root or new threads reuse the wrong contextId. */
    const directConversationRootId = threadRootIdForMessage(combinedAfterUser, userUi.id);
    const a2aSessionStorageKey =
      scope.kind === 'direct' ? `${threadId}#root=${directConversationRootId}` : threadId;
    try {
      const resolvedBase = (await resolveScopeBaseUrl()).trim();
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H1-H4',location:'hooks/useAgent.ts:send',message:'send invoked with resolved base',data:{scopeKind:scope.kind,resolvedBase,hasSession:Boolean(session?.user?.id),textLen:userText.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const [a2aToken, a2aTimeoutMs, a2aRetryCount] = await Promise.all([
        getA2aToken(),
        getA2aTimeoutMs(),
        getA2aRetryCount(),
      ]);
      if (resolvedBase) {
        if (scope.kind === 'direct' && isSluglessGatewayTarget(resolvedBase)) {
          // #region agent log
          fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'post-fix',hypothesisId:'H2-confirmed',location:'hooks/useAgent.ts:send',message:'blocked direct send to slugless gateway target',data:{resolvedBase,scopeKind:scope.kind},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          throw new Error('This agent URL is missing a slug. Open the agent from Directory/Requests so the URL includes /a2a/v1/<agent-slug>.');
        }
        const a2aUrl = resolvedBase;
        setCurrentAgentBaseUrl(a2aUrl.replace(/\/+$/, ''));
        await ensureRemoteCapabilities();
        const cachedOauthAccessToken = await getCachedA2aOauthToken(a2aUrl);
        let personaPrefix = '';
        if (scope.kind === 'userAgent') {
          const ua = await getUserAgent(scope.userAgentId);
          if (ua?.instructions?.trim()) {
            personaPrefix = `User agent persona (how this channel should behave): ${ua.instructions.trim()}\n\n`;
          }
        }
        const contextBody = nextTurns
          .slice(-12)
          .map((t) => `${t.role}: ${t.text}`)
          .join('\n')
          .slice(0, 3000);
        const context = (personaPrefix + contextBody).slice(0, 3200);
        setRemoteState('running');
        const workingId = newId();
        setMessages((m) => [
          ...m,
          userUi,
          { id: workingId, role: 'assistant', text: 'Working...', replyToId: userUi.id },
        ]);
        void a2aService
          .runTask({
            config: {
              baseUrl: a2aUrl.trim(),
              token: a2aToken?.trim() || null,
              timeoutMs: a2aTimeoutMs,
              retryCount: a2aRetryCount,
              pushChannel: 'expo',
              pushToken: await getCurrentExpoPushToken(),
            },
            threadId: a2aSessionStorageKey,
            userMessage: userText,
            context,
            supabaseAccessToken: session?.access_token ?? null,
            oauthAccessToken: cachedOauthAccessToken || undefined,
            onSubmitted: ({ taskId, sessionId }) => {
              activeTaskRef.current = { taskId, sessionId, messageId: workingId, baseUrl: a2aUrl.trim() };
              upsertActiveSubscription({
                taskId,
                sessionId,
                baseUrl: a2aUrl.trim().replace(/\/+$/, ''),
              });
              if (scope.kind === 'direct') {
                void dismissAgentInboundBySenderRpcUrl(a2aUrl.trim()).catch(() => {});
              }
            },
            onState: (s) => {
              if (s === 'completed') setRemoteState('completed');
              else if (s === 'failed' || s === 'cancelled') setRemoteState('failed');
              else setRemoteState('running');
            },
          })
          .then((result) => {
            if (result.status === 'auth_required' && result.auth?.authorizationUrl) {
              // eslint-disable-next-line no-console
              console.log('[A2A][oauth] auth_required received from agent:', {
                authorizationUrl: result.auth.authorizationUrl,
                scopes: result.auth.scopes,
                provider: result.auth.provider,
              });
              void (async () => {
                const [a2aTokenOAuth, a2aTimeoutMsOAuth, a2aRetryCountOAuth] = await Promise.all([
                  getA2aToken(),
                  getA2aTimeoutMs(),
                  getA2aRetryCount(),
                ]);
                const oauthBaseUrl = inferOAuthBaseUrl(result.auth?.authorizationUrl);
                if (!oauthBaseUrl) {
                  const text = normalizeIncomingAssistantText(result.output || 'Authentication required, but OAuth URL is missing.', dslEnabled);
                  setMessages((m) => m.map((x) => (x.id === workingId ? { ...x, text } : x)));
                  return;
                }
                // eslint-disable-next-line no-console
                console.log('[A2A][oauth] running MCP OAuth for base:', oauthBaseUrl);
                const oauth = await runMcpOAuthForBaseUrl(oauthBaseUrl);
                if (!oauth.ok) {
                  // eslint-disable-next-line no-console
                  console.log('[A2A][oauth] OAuth failed:', oauth.message);
                  const text = normalizeIncomingAssistantText(`A2A auth failed: ${oauth.message}`, dslEnabled);
                  setMessages((m) => m.map((x) => (x.id === workingId ? { ...x, text } : x)));
                  setRemoteState('failed');
                  return;
                }
                // eslint-disable-next-line no-console
                console.log('[A2A][oauth] OAuth succeeded, token len:', oauth.accessToken.length);
                await setCachedA2aOauthToken(a2aUrl, oauth.accessToken);
                const resumed = await a2aService.continueAuthRequiredTask({
                  config: {
                    baseUrl: a2aUrl.trim(),
                    token: a2aTokenOAuth?.trim() || null,
                    timeoutMs: a2aTimeoutMsOAuth,
                    retryCount: a2aRetryCountOAuth,
                    pushChannel: 'expo',
                    pushToken: await getCurrentExpoPushToken(),
                  },
                  taskId: result.taskId,
                  contextId: result.sessionId,
                  oauthAccessToken: oauth.accessToken,
                  supabaseAccessToken: session?.access_token ?? null,
                });
                // eslint-disable-next-line no-console
                console.log('[A2A][oauth] resume result:', { status: resumed.status, error: resumed.error, authUrl: resumed.auth?.authorizationUrl });
                const resumedText =
                  resumed.status === 'completed'
                    ? resumed.output || 'Remote agent completed.'
                    : resumed.status === 'auth_required'
                      ? resumed.output || 'Authentication still required.'
                      : resumed.error || `A2A failed: ${resumed.status}`;
                const asstText = normalizeIncomingAssistantText(resumedText, dslEnabled);
                setMessages((m) => m.map((x) => (x.id === workingId ? { ...x, text: asstText, taskId: resumed.taskId, traceId: resumed.traceId } : x)));
                setRemoteState(resumed.status === 'completed' ? 'completed' : resumed.status === 'auth_required' ? 'running' : 'failed');
                appendTerminalTaskToSubscriptionFeed(a2aUrl, resumed);
              })().catch(() => {
                setMessages((m) => m.map((x) => (x.id === workingId ? { ...x, text: 'A2A auth continuation failed.' } : x)));
                setRemoteState('failed');
              });
              appendTerminalTaskToSubscriptionFeed(a2aUrl, result);
              activeTaskRef.current = null;
              return;
            }
            if (result.status === 'auth_required' && !result.auth?.authorizationUrl) {
              const asstText = normalizeIncomingAssistantText(
                result.output || 'Authentication is required for this task. Please reconnect or retry OAuth.',
                dslEnabled
              );
              setMessages((m) => m.map((x) => (x.id === workingId ? { ...x, text: asstText, taskId: result.taskId, traceId: result.traceId } : x)));
              appendTerminalTaskToSubscriptionFeed(a2aUrl, result);
              setRemoteState('running');
              activeTaskRef.current = null;
              return;
            }
            const errText = result.error || 'Unknown remote error';
            const rawText =
              result.status === 'completed'
                ? result.output || 'Remote agent completed.'
                : result.status === 'input_required' || result.status === 'auth_required'
                  ? result.output || 'Remote agent requires more input to continue this task.'
                    : result.status === 'running' &&
                      result.subscription?.isSubscription
                    ? assistantTextFromSubscriptionPushSnapshot(result) ||
                      'Subscription active.'
                    : errText.toLowerCase().includes('unsupported')
                      ? 'This request is unsupported by the remote agent. Try a Task 1 / Task 2 style request.'
                      : toUserFacingA2aError(errText);
            const asstText = normalizeIncomingAssistantText(rawText, dslEnabled);
            if (
              session?.user?.id &&
              (scope.kind === 'direct' || scope.kind === 'userAgent') &&
              (result.status === 'completed' ||
                result.status === 'input_required' ||
                result.status === 'auth_required') &&
              !(result.status === 'running' && result.subscription?.isSubscription)
            ) {
              void insertClientPairFromA2aTurn({
                threadId,
                taskId: result.taskId,
                userText,
                assistantText: asstText,
                contextId: result.sessionId,
              });
            }
            void streamAssistantText(workingId, asstText);
            setMessages((m) =>
              m.map((x) =>
                x.id === workingId
                  ? {
                      ...x,
                      taskId: result.taskId,
                      traceId: result.traceId,
                      subscription:
                        result.subscription?.isSubscription
                          ? {
                              unsubscribeTaskId: result.subscription.unsubscribeTaskId,
                              runCount: result.subscription.runCount,
                            }
                          : undefined,
                      subscriptionEmissionRunCount:
                        result.subscription?.isSubscription
                          ? typeof result.subscription.runCount === 'number'
                            ? result.subscription.runCount
                            : 0
                          : undefined,
                    }
                  : x
              )
            );
            if (result.subscription?.isSubscription) {
              const b = a2aUrl.trim().replace(/\/+$/, '');
              upsertActiveSubscription({
                unsubscribeTaskId: result.subscription.unsubscribeTaskId,
                taskId: result.taskId,
                runCount: result.subscription.runCount,
                baseUrl: b,
                sessionId: result.sessionId,
              });
            }
            if (
              result.status === 'running' &&
              result.subscription?.isSubscription
            ) {
              void appendSubscriptionFeedItemFromTask(a2aUrl.trim().replace(/\/+$/, ''), result);
            } else {
              appendTerminalTaskToSubscriptionFeed(a2aUrl, result);
            }
            activeTaskRef.current = null;
          })
          .catch((e) => {
            const err = e instanceof Error ? e.message : String(e);
            const asstText = normalizeIncomingAssistantText(err.toLowerCase().includes('unsupported') ? 'This request is unsupported by the remote agent. Try a Task 1 / Task 2 style request.' : toUserFacingA2aError(err), dslEnabled);
            setMessages((m) => m.map((x) => (x.id === workingId ? { ...x, text: asstText } : x)));
            setRemoteState('failed');
            activeTaskRef.current = null;
          });
        setSending(false);
        return;
      }

      setMessages((m) => [...m, userUi]);

      const [azureKey, azureUrl, openAiKey, anthropicKey, openAiModel] = await Promise.all([getAzureOpenAiKey(), getAzureChatCompletionsUrl(), getOpenAiKey(), getAnthropicKey(), getOpenAiModel()]);
      const azureReady = !!azureKey?.trim() && !!azureUrl.trim();
      const openAiReady = !!openAiKey?.trim();
      const anthropicReady = !!anthropicKey?.trim();
      if (!azureReady && !openAiReady && !anthropicReady)
        throw new Error('Add Azure/OpenAI/Anthropic API credentials in Settings to use local agent chat.');
      const provider = azureReady ? 'azure' : openAiReady ? 'openai' : 'anthropic';
      const parsed = await callAgent({ provider, apiKey: provider === 'azure' ? azureKey!.trim() : provider === 'openai' ? openAiKey!.trim() : anthropicKey!.trim(), model: provider === 'anthropic' ? 'claude-sonnet-4-6' : openAiModel, azureUrl: azureUrl.trim() || undefined, turns: nextTurns.slice(-20) });
      const asstUi: AgentUiMessage = {
        id: newId(),
        role: 'assistant',
        text: normalizeIncomingAssistantText(parsed.text || `Rendered via ${parsed.providerUsed}.`, dslEnabled),
        components: parsed.components,
        replyToId: userUi.id,
      };
      setRemoteState('completed');
      setMessages((m) => [...m, asstUi]);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setRemoteState('failed');
      setMessages((m) => [...m, { id: newId(), role: 'assistant', text: `Error: ${err}`, replyToId: userUi.id }]);
    } finally {
      setSending(false);
    }
    },
    [
      dslEnabled,
      ensureRemoteCapabilities,
      messages,
      resolveScopeBaseUrl,
      scope,
      sending,
      streamAssistantText,
      threadId,
      upsertActiveSubscription,
      session?.access_token,
      session?.user?.id,
    ]
  );

  const unsubscribe = useCallback(async (unsubscribeTaskId: string) => {
    const a2aUrl = (await resolveScopeBaseUrl()).trim();
    const [a2aToken, timeoutMs, retryCount] = await Promise.all([
      getA2aToken(),
      getA2aTimeoutMs(),
      getA2aRetryCount(),
    ]);
    if (!a2aUrl) return;
    await a2aService.cancelTask({
      config: { baseUrl: a2aUrl, token: a2aToken?.trim() || null, timeoutMs, retryCount },
      taskId: unsubscribeTaskId,
    });
    setActiveSubscriptions((prev) => prev.filter((x) => x.unsubscribeTaskId !== unsubscribeTaskId));
  }, [resolveScopeBaseUrl]);

  const deleteThread = useCallback(
    (rootId: string) => {
      setMessages((prev) => {
        const next = prev.filter((m) => threadRootIdForMessage(prev, m.id) !== rootId);
        void deleteThreadFromStorage(threadId, rootId);
        return next;
      });
    },
    [threadId]
  );

  const hasMessages = useMemo(() => messages.length > 0, [messages.length]);
  return {
    messages,
    sending,
    send,
    hasMessages,
    remoteState,
    connectRemote,
    dslEnabled,
    activeSubscriptions,
    unsubscribe,
    trackTaskUpdates,
    deleteThread,
    classifyAgentPayload,
  };
}
