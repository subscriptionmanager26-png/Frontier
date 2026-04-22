import Constants from 'expo-constants';

import { MockA2AProvider } from '@/lib/a2a/mockProvider';
import {
  getA2aTaskPushWebhookBearer,
  getA2aTaskPushWebhookUrl,
} from '@/lib/appSettings';
import { getCurrentExpoPushToken } from '@/lib/notifications';
import type { A2aProviderConfig } from '@/lib/a2a/provider';
import { getA2aSessionMap, logA2aHop, upsertA2aSessionMap } from '@/lib/a2a/store';
import type { A2aNormalizedError, A2aTaskResult } from '@/lib/a2a/types';

type CircuitState = { failures: number; openUntil: number };
const CIRCUIT: Record<string, CircuitState> = {};

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isCircuitOpen(url: string): boolean {
  const st = CIRCUIT[url];
  return !!st && st.openUntil > Date.now();
}

function markFailure(url: string): void {
  const cur = CIRCUIT[url] ?? { failures: 0, openUntil: 0 };
  const failures = cur.failures + 1;
  const openMs = failures >= 3 ? 15_000 : 0;
  CIRCUIT[url] = { failures, openUntil: Date.now() + openMs };
}

function markSuccess(url: string): void {
  CIRCUIT[url] = { failures: 0, openUntil: 0 };
}

function normalizeA2aError(e: unknown): A2aNormalizedError {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.toLowerCase();
  if (m.includes('versionnotsupportederror') || m.includes('incompatible protocol version')) {
    return { code: 'version_not_supported', message: msg, retryable: false };
  }
  if (m.includes('tasknotfounderror')) return { code: 'task_not_found', message: msg, retryable: false };
  if (m.includes('tasknotcancelableerror')) return { code: 'task_not_cancelable', message: msg, retryable: false };
  if (m.includes('unsupportedoperationerror')) return { code: 'unsupported_operation', message: msg, retryable: false };
  if (m.includes('invalid params') || m.includes('-32602')) return { code: 'invalid_params', message: msg, retryable: false };
  if (m.includes('401') || m.includes('403')) return { code: 'auth', message: msg, retryable: false };
  if (m.includes('timeout') || m.includes('abort')) return { code: 'timeout', message: msg, retryable: true };
  if (m.includes('429')) return { code: 'rate_limited', message: msg, retryable: true };
  if (m.includes('network') || m.includes('failed to fetch')) return { code: 'unavailable', message: msg, retryable: true };
  return { code: 'remote', message: msg, retryable: false };
}

export class A2aService {
  private provider = new MockA2AProvider();

  async listTasks(args: { config: A2aProviderConfig }): Promise<A2aTaskResult[]> {
    return this.provider.listTasks(args.config);
  }

  async setTaskPushNotificationConfig(args: {
    config: A2aProviderConfig;
    taskId: string;
    pushNotificationConfig: { url: string; authentication?: { scheme?: string; schemes?: string[]; credentials: string } };
  }): Promise<void> {
    await this.provider.setTaskPushNotificationConfig(args.config, {
      taskId: args.taskId,
      pushNotificationConfig: args.pushNotificationConfig,
    });
  }

  async getTaskPushNotificationConfig(args: {
    config: A2aProviderConfig;
    taskId: string;
  }) {
    return this.provider.getTaskPushNotificationConfig(args.config, {
      taskId: args.taskId,
    });
  }

  async connect(config: A2aProviderConfig) {
    const requestId = uuid();
    await logA2aHop({
      level: 'info',
      requestId,
      agentUrl: config.baseUrl,
      hop: 'connect.start',
      status: 'connecting',
    });
    if (isCircuitOpen(config.baseUrl)) {
      await logA2aHop({
        level: 'info',
        requestId,
        agentUrl: config.baseUrl,
        hop: 'connect.circuit_open_retry',
        status: 'connecting',
      });
    }
    const res = await this.provider.connect(config);
    if (res.ok) {
      markSuccess(config.baseUrl);
      await logA2aHop({
        level: 'info',
        requestId,
        agentUrl: config.baseUrl,
        hop: 'connect.success',
        status: 'connected',
        detail: res.metadata,
      });
      return res;
    }
    markFailure(config.baseUrl);
    await logA2aHop({
      level: 'error',
      requestId,
      agentUrl: config.baseUrl,
      hop: 'connect.error',
      status: 'failed',
      detail: { error: res.error },
    });
    return res;
  }

  async getTaskOnce(args: {
    config: A2aProviderConfig;
    taskId: string;
    contextId?: string;
    correlationId?: string;
  }): Promise<A2aTaskResult> {
    return this.provider.pollTask(args.config, {
      taskId: args.taskId,
      contextId: args.contextId,
      correlationId: args.correlationId,
    });
  }

  async cancelTask(args: {
    config: A2aProviderConfig;
    taskId: string;
    contextId?: string;
    correlationId?: string;
  }): Promise<void> {
    const requestId = uuid();
    try {
      await logA2aHop({
        level: 'info',
        requestId,
        correlationId: args.correlationId,
        sessionId: args.contextId,
        taskId: args.taskId,
        agentUrl: args.config.baseUrl,
        hop: 'task.cancel.request',
        status: 'running',
      });
      await this.provider.cancelTask(args.config, {
        taskId: args.taskId,
        contextId: args.contextId,
        correlationId: args.correlationId,
      });
      await logA2aHop({
        level: 'info',
        requestId,
        correlationId: args.correlationId,
        sessionId: args.contextId,
        taskId: args.taskId,
        agentUrl: args.config.baseUrl,
        hop: 'task.cancel.success',
        status: 'cancelled',
      });
    } catch (e) {
      const n = normalizeA2aError(e);
      // Idempotent UX: cancelling an already-terminal task is treated as success.
      if (n.code === 'task_not_cancelable' || n.code === 'task_not_found') {
        await logA2aHop({
          level: 'info',
          requestId,
          correlationId: args.correlationId,
          sessionId: args.contextId,
          taskId: args.taskId,
          agentUrl: args.config.baseUrl,
          hop: 'task.cancel.noop',
          status: 'cancelled',
          detail: { reason: n.code, message: n.message },
        });
        return;
      }
      await logA2aHop({
        level: 'error',
        requestId,
        correlationId: args.correlationId,
        sessionId: args.contextId,
        taskId: args.taskId,
        agentUrl: args.config.baseUrl,
        hop: 'task.cancel.error',
        status: 'failed',
        detail: { reason: n.code, message: n.message },
      });
      throw e;
    }
  }

  async runTask(args: {
    config: A2aProviderConfig;
    threadId: string;
    userMessage: string;
    context?: string;
    userIdHash?: string;
    oauthAccessToken?: string;
    /** Forwarded as X-Supabase-Access-Token for gateway owner inbox. */
    supabaseAccessToken?: string | null;
    onSubmitted?: (x: { taskId: string; sessionId: string; correlationId: string }) => void;
    onState?: (s: 'running' | 'completed' | 'failed' | 'input_required' | 'auth_required' | 'cancelled') => void;
  }): Promise<A2aTaskResult> {
    const { config, threadId } = args;
    const cfg: A2aProviderConfig = {
      ...config,
      supabaseAccessToken: args.supabaseAccessToken ?? config.supabaseAccessToken ?? null,
    };
    const requestId = uuid();
    const correlationId = uuid();
    if (isCircuitOpen(cfg.baseUrl)) {
      await logA2aHop({
        level: 'info',
        requestId,
        correlationId,
        agentUrl: cfg.baseUrl,
        hop: 'task.circuit_open_retry',
        status: 'running',
      });
    }

    const existing = await getA2aSessionMap(threadId);
    const safeUserMessage = (args.userMessage || '').trim();
    const boundedContext = args.context?.slice(0, 4000);
    // Product rule: each new user turn creates a new taskId.
    // Prior task linkage is carried via referenceTaskIds, not taskId continuation.
    const continuationTaskId = undefined;
    const referenceTaskIds = existing?.lastTaskId ? [existing.lastTaskId] : [];
    const [pushHookUrl, pushHookBearer] = await Promise.all([
      getA2aTaskPushWebhookUrl(),
      getA2aTaskPushWebhookBearer(),
    ]);
    const trimmedHook = pushHookUrl.trim();
    const configuration =
      trimmedHook.length > 0
        ? (() => {
            const authentication = pushHookBearer.trim()
              ? {
                  scheme: 'Bearer' as const,
                  schemes: ['bearer'] as const,
                  credentials: pushHookBearer.trim(),
                }
              : undefined;
            const taskPushNotificationConfig = {
              url: trimmedHook,
              ...(authentication ? { authentication } : {}),
            };
            return {
              returnImmediately: true,
              taskPushNotificationConfig,
              // Wire alias: remote agents often implement `pushNotificationConfig` only.
              pushNotificationConfig: taskPushNotificationConfig,
            };
          })()
        : undefined;
    const submit = await this.provider.submitTask(cfg, {
      // Strict A2A mode: never auto-reuse previous taskId for new turns.
      // Continue via taskId only for interrupted tasks; otherwise contextId + referenceTaskIds.
      taskId: continuationTaskId,
      contextId: existing?.sessionId ?? undefined,
      referenceTaskIds,
      userMessage: safeUserMessage,
      context: boundedContext,
      metadata: {
        appVersion: String(Constants.expoConfig?.version || 'dev'),
        userIdHash: args.userIdHash,
        correlationId,
      },
      oauthAccessToken: args.oauthAccessToken,
      ...(configuration ? { configuration } : {}),
      // Compatibility fields for mock/heterogeneous A2A servers.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( {
        input: {
          text: safeUserMessage,
          message: safeUserMessage,
          context: boundedContext,
        },
        message: safeUserMessage,
        prompt: safeUserMessage,
      } as any ),
    });
    const safeSessionId = submit.sessionId || existing?.sessionId || submit.taskId;
    const safeTaskId = submit.taskId || existing?.lastTaskId || uuid();
    await upsertA2aSessionMap({
      threadId,
      agentUrl: config.baseUrl,
      sessionId: safeSessionId,
      lastTaskId: safeTaskId,
      lastTaskStatus: submit.status,
    });
    await logA2aHop({
      level: 'info',
      requestId,
      correlationId,
      sessionId: safeSessionId,
      taskId: safeTaskId,
      agentUrl: config.baseUrl,
      hop: 'task.submit',
      status: submit.status,
      detail: {
        threadId,
        userMessage: safeUserMessage,
      },
    });
    args.onSubmitted?.({ taskId: safeTaskId, sessionId: safeSessionId, correlationId });

    // A2A-compliant per-task registration. Optional on many gateways; must not fail the user turn if unsupported.
    if (trimmedHook.length > 0) {
      try {
        const pushToken = await getCurrentExpoPushToken().catch(() => null);
        if (pushToken?.trim()) {
          await this.provider.setTaskPushNotificationConfig(config, {
            taskId: safeTaskId,
            pushNotificationConfig: {
              url: trimmedHook,
              authentication: {
                schemes: ['bearer'],
                credentials: pushToken.trim(),
              },
            },
          });
        } else if (pushHookBearer.trim()) {
          await this.provider.setTaskPushNotificationConfig(config, {
            taskId: safeTaskId,
            pushNotificationConfig: {
              url: trimmedHook,
              authentication: {
                schemes: ['bearer'],
                credentials: pushHookBearer.trim(),
              },
            },
          });
        }
      } catch {
        // Remote agent may not implement tasks/pushNotificationConfig/* (JSON-RPC -32601).
      }
    }

    if (submit.status === 'input_required' || submit.status === 'auth_required') {
      markSuccess(config.baseUrl);
      args.onState?.(submit.status);
      return {
        taskId: safeTaskId,
        sessionId: safeSessionId,
        status: submit.status,
        traceId: submit.traceId,
        output: submit.output,
        auth: submit.auth,
      };
    }
    if (submit.status === 'cancelled') {
      args.onState?.('cancelled');
      return {
        taskId: safeTaskId,
        sessionId: safeSessionId,
        status: 'cancelled',
        traceId: submit.traceId,
      };
    }
    args.onState?.('running');
    const started = Date.now();
    let last: string = submit.status;
    while (Date.now() - started < config.timeoutMs) {
      const polled = await this.provider.pollTask(config, {
        taskId: safeTaskId,
        contextId: safeSessionId,
        correlationId,
      });
      last = polled.status;
      if (polled.status === 'completed') {
        markSuccess(config.baseUrl);
        args.onState?.('completed');
        await upsertA2aSessionMap({
          threadId,
          agentUrl: config.baseUrl,
          sessionId: polled.sessionId,
          lastTaskId: polled.taskId,
          lastTaskStatus: polled.status,
        });
        await logA2aHop({
          level: 'info',
          requestId,
          correlationId,
          sessionId: polled.sessionId,
          taskId: polled.taskId,
          agentUrl: config.baseUrl,
          hop: 'task.completed',
          status: polled.status,
          detail: { traceId: polled.traceId },
        });
        return polled;
      }
      if (polled.status === 'failed') {
        markFailure(config.baseUrl);
        args.onState?.('failed');
        await upsertA2aSessionMap({
          threadId,
          agentUrl: config.baseUrl,
          sessionId: polled.sessionId,
          lastTaskId: polled.taskId,
          lastTaskStatus: polled.status,
        });
        await logA2aHop({
          level: 'error',
          requestId,
          correlationId,
          sessionId: polled.sessionId,
          taskId: polled.taskId,
          agentUrl: config.baseUrl,
          hop: 'task.failed',
          status: polled.status,
          detail: { error: polled.error, traceId: polled.traceId },
        });
        return polled;
      }
      if (polled.status === 'input_required' || polled.status === 'auth_required') {
        markSuccess(config.baseUrl);
        args.onState?.(polled.status);
        await upsertA2aSessionMap({
          threadId,
          agentUrl: config.baseUrl,
          sessionId: polled.sessionId,
          lastTaskId: polled.taskId,
          lastTaskStatus: polled.status,
        });
        return polled;
      }
      if (polled.status === 'cancelled') {
        args.onState?.('cancelled');
        await upsertA2aSessionMap({
          threadId,
          agentUrl: config.baseUrl,
          sessionId: polled.sessionId,
          lastTaskId: polled.taskId,
          lastTaskStatus: polled.status,
        });
        return polled;
      }
      /**
       * Subscription tasks stay WORKING/running for the whole lifetime. Do not block until timeout —
       * that produced a fake "failed" result with no subscription metadata, so the app never stored
       * activeSubscriptions and Updates/Sync/push routing broke.
       */
      if (
        polled.status === 'running' &&
        polled.subscription?.isSubscription
      ) {
        markSuccess(config.baseUrl);
        args.onState?.('running');
        await upsertA2aSessionMap({
          threadId,
          agentUrl: config.baseUrl,
          sessionId: polled.sessionId,
          lastTaskId: polled.taskId,
          lastTaskStatus: polled.status,
        });
        await logA2aHop({
          level: 'info',
          requestId,
          correlationId,
          sessionId: polled.sessionId,
          taskId: polled.taskId,
          agentUrl: config.baseUrl,
          hop: 'task.subscription.running',
          status: polled.status,
          detail: { traceId: polled.traceId, unsubscribeTaskId: polled.subscription?.unsubscribeTaskId },
        });
        return polled;
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    markFailure(config.baseUrl);
    args.onState?.('failed');
    await logA2aHop({
      level: 'error',
      requestId,
      correlationId,
      sessionId: submit.sessionId,
      taskId: safeTaskId,
      agentUrl: config.baseUrl,
      hop: 'task.timeout',
      status: last,
    });
    return {
      taskId: safeTaskId,
      sessionId: safeSessionId,
      status: 'failed',
      error: 'Timed out waiting for remote agent response.',
    };
  }

  async continueAuthRequiredTask(args: {
    config: A2aProviderConfig;
    taskId: string;
    contextId: string;
    oauthAccessToken: string;
    supabaseAccessToken?: string | null;
  }): Promise<A2aTaskResult> {
    const cfg: A2aProviderConfig = {
      ...args.config,
      supabaseAccessToken: args.supabaseAccessToken ?? args.config.supabaseAccessToken ?? null,
    };
    const submit = await this.provider.submitTask(cfg, {
      taskId: args.taskId,
      contextId: args.contextId,
      oauthAccessToken: args.oauthAccessToken,
      userMessage: 'continue',
      metadata: {
        appVersion: String(Constants.expoConfig?.version || 'dev'),
      },
    });
    return this.provider.pollTask(cfg, {
      taskId: submit.taskId || args.taskId,
      contextId: submit.sessionId || args.contextId,
    });
  }
}

export const a2aService = new A2aService();
