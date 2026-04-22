import { gatewayRootForAgentDiscovery } from '@/lib/a2a/gatewayUrl';
import type { RemoteAgentProvider, A2aProviderConfig } from '@/lib/a2a/provider';
import type {
  A2aPushNotificationConfig,
  A2aConnectResult,
  A2aNormalizedError,
  A2aTaskInput,
  A2aTaskResult,
  A2aTaskSubmitResponse,
} from '@/lib/a2a/types';

type ParsedSubscription = NonNullable<A2aTaskResult['subscription']>;

function parseMetadataSubscription(metadata: Record<string, unknown>): ParsedSubscription | undefined {
  const subVal = metadata.subscription;

  const fromNested = (o: Record<string, unknown>): ParsedSubscription => {
    const unsub = typeof o.unsubscribeTaskId === 'string' ? o.unsubscribeTaskId : undefined;
    const countRaw = o.emission_count ?? o.emissionCount ?? o.runCount;
    const runCount = typeof countRaw === 'number' ? countRaw : undefined;
    return {
      isSubscription: Boolean(o.isSubscription || o.subscription === true || unsub),
      interval: typeof o.interval === 'string' ? o.interval : undefined,
      nextEmissionAt:
        typeof o.nextEmissionAt === 'string'
          ? o.nextEmissionAt
          : typeof o.next_emission_at === 'string'
            ? o.next_emission_at
            : undefined,
      cadenceMs: typeof o.cadenceMs === 'number' ? o.cadenceMs : undefined,
      startedAt: typeof o.startedAt === 'string' ? o.startedAt : undefined,
      endsAt: typeof o.endsAt === 'string' ? o.endsAt : undefined,
      runCount,
      unsubscribeTaskId: unsub,
    };
  };

  if (subVal === true) {
    const countRaw = metadata.emission_count ?? metadata.emissionCount ?? metadata.runCount;
    const runCount = typeof countRaw === 'number' ? countRaw : undefined;
    const unsub = typeof metadata.unsubscribeTaskId === 'string' ? metadata.unsubscribeTaskId : undefined;
    return {
      isSubscription: true,
      interval: typeof metadata.interval === 'string' ? metadata.interval : undefined,
      nextEmissionAt:
        typeof metadata.next_emission_at === 'string'
          ? metadata.next_emission_at
          : typeof metadata.nextEmissionAt === 'string'
            ? metadata.nextEmissionAt
            : undefined,
      cadenceMs: typeof metadata.cadenceMs === 'number' ? metadata.cadenceMs : undefined,
      startedAt: typeof metadata.startedAt === 'string' ? metadata.startedAt : undefined,
      endsAt: typeof metadata.endsAt === 'string' ? metadata.endsAt : undefined,
      runCount,
      unsubscribeTaskId: unsub,
    };
  }

  if (subVal && typeof subVal === 'object' && !Array.isArray(subVal)) {
    const s = fromNested(subVal as Record<string, unknown>);
    if (s.isSubscription || s.unsubscribeTaskId || s.runCount !== undefined || s.interval || s.nextEmissionAt) {
      return s;
    }
  }

  return undefined;
}

type DiscoveryCard = {
  protocolVersion?: string;
  protocol?: { version?: string };
  url?: string;
  supportedModalities?: string[];
  supportedTools?: string[];
  endpoints?: { rpc?: string };
  supportedInterfaces?: Array<{
    url?: string;
    protocolBinding?: string;
    protocolVersion?: string;
  }>;
  limits?: { maxPayloadBytes?: number; ratePerMinute?: number; streaming?: boolean };
  capabilities?: { modalities?: string[]; tools?: string[]; streaming?: boolean };
  skills?: Array<{ tags?: string[] }>;
};

const RPC_ENDPOINT_BY_BASE: Record<string, string> = {};
const PROTOCOL_VERSION_BY_BASE: Record<string, string> = {};
const STREAMING_SUPPORTED_BY_BASE: Record<string, boolean> = {};

class A2aRpcError extends Error {
  code?: number;
  rpcMessage?: string;
  data?: unknown;
  httpStatus?: number;
  constructor(message: string, args?: { code?: number; rpcMessage?: string; data?: unknown; httpStatus?: number }) {
    super(message);
    this.code = args?.code;
    this.rpcMessage = args?.rpcMessage;
    this.data = args?.data;
    this.httpStatus = args?.httpStatus;
  }
}

function maskToken(token: string | null | undefined): string {
  if (!token) return 'none';
  const t = String(token);
  const len = t.length;
  const tail = len >= 6 ? t.slice(-6) : t;
  return `len=${len},tail=${tail}`;
}

function errorTextIncludes(value: unknown, needle: string): boolean {
  return String(value ?? '').toLowerCase().includes(needle.toLowerCase());
}

function normalizeError(e: unknown): A2aNormalizedError {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof A2aRpcError) {
    const rpcMsg = e.rpcMessage || '';
    if (e.code === -32004 || errorTextIncludes(rpcMsg, 'VersionNotSupportedError')) {
      return { code: 'version_not_supported', message: msg, retryable: false };
    }
    if (e.code === -32001 || errorTextIncludes(rpcMsg, 'TaskNotFoundError')) {
      return { code: 'task_not_found', message: msg, retryable: false };
    }
    if (e.code === -32013 || errorTextIncludes(rpcMsg, 'TaskNotCancelableError')) {
      return { code: 'task_not_cancelable', message: msg, retryable: false };
    }
    if (e.code === -32010 || errorTextIncludes(rpcMsg, 'UnsupportedOperationError')) {
      return { code: 'unsupported_operation', message: msg, retryable: false };
    }
    if (e.code === -32602 || errorTextIncludes(rpcMsg, 'Invalid params')) {
      return { code: 'invalid_params', message: msg, retryable: false };
    }
    if (e.code === -32700) return { code: 'parse_error', message: msg, retryable: false };
    if (e.code === -32601) return { code: 'method_not_found', message: msg, retryable: false };
    if (errorTextIncludes(rpcMsg, 'ContentTypeNotSupportedError')) {
      return { code: 'content_type_not_supported', message: msg, retryable: false };
    }
    if (errorTextIncludes(rpcMsg, 'ExtensionSupportRequiredError')) {
      return { code: 'extension_required', message: msg, retryable: false };
    }
  }
  const m = msg.toLowerCase();
  if (m.includes('401') || m.includes('403')) return { code: 'auth', message: msg, retryable: false };
  if (m.includes('timeout') || m.includes('abort')) return { code: 'timeout', message: msg, retryable: true };
  if (m.includes('429')) return { code: 'rate_limited', message: msg, retryable: true };
  if (m.includes('versionnotsupportederror')) return { code: 'version_not_supported', message: msg, retryable: false };
  if (m.includes('network') || m.includes('failed to fetch')) return { code: 'unavailable', message: msg, retryable: true };
  return { code: 'remote', message: msg, retryable: false };
}

async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await work(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson<T>(
  config: A2aProviderConfig,
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'A2A-Version': '1.0',
    // Required for free ngrok tunnels to bypass warning interstitial.
    'ngrok-skip-browser-warning': '1',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  if (config.supabaseAccessToken?.trim()) {
    headers["x-supabase-access-token"] = config.supabaseAccessToken.trim();
  }
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${config.baseUrl.replace(/\/+$/, '')}${path}`;
  const res = await withTimeout(config.timeoutMs, (signal) =>
    fetch(url, { ...init, headers, signal })
  );
  const text = await res.text();
  if (!res.ok) {
    // #region agent log
    fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H1-H2-H4',location:'lib/a2a/mockProvider.ts:fetchJson',message:'http error from a2a request',data:{url,status:res.status,method:(init?.method||'GET')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw new A2aRpcError(`${res.status} ${text}`, { httpStatus: res.status });
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function fetchText(
  config: A2aProviderConfig,
  path: string,
  init?: RequestInit
): Promise<string> {
  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    'A2A-Version': '1.0',
    'ngrok-skip-browser-warning': '1',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  if (config.supabaseAccessToken?.trim()) {
    headers["x-supabase-access-token"] = config.supabaseAccessToken.trim();
  }
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${config.baseUrl.replace(/\/+$/, '')}${path}`;
  const res = await withTimeout(config.timeoutMs, (signal) =>
    fetch(url, { ...init, headers, signal })
  );
  const text = await res.text();
  if (!res.ok) throw new A2aRpcError(`${res.status} ${text}`, { httpStatus: res.status });
  return text;
}

async function rpcCall<T>(
  config: A2aProviderConfig,
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  type RpcResponse = { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
  const base = config.baseUrl.replace(/\/+$/, '');
  const rpcUrl = RPC_ENDPOINT_BY_BASE[base] ?? `${base}/a2a/v1`;
  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H1-H2-H3',location:'lib/a2a/mockProvider.ts:rpcCall',message:'computed rpc url for call',data:{base,rpcUrl,method},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const res = await fetchJson<RpcResponse>(config, rpcUrl, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  if (res.error) {
    const msg = `${res.error.code ?? ''} ${res.error.message ?? 'RPC error'}`.trim();
    throw new A2aRpcError(msg, {
      code: res.error.code,
      rpcMessage: res.error.message,
      data: res.error.data,
    });
  }
  return (res.result ?? {}) as T;
}

async function rpcStreamSendMessage(
  config: A2aProviderConfig,
  params: Record<string, unknown>
): Promise<unknown> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = config.baseUrl.replace(/\/+$/, '');
  const rpcUrl = RPC_ENDPOINT_BY_BASE[base] ?? `${base}/a2a/v1`;
  const raw = await fetchText(config, rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'SendStreamingMessage',
      params,
    }),
  });
  const head = raw.trimStart();
  // Some agents respond with plain JSON-RPC (e.g. returnImmediately) even for SendStreamingMessage.
  if (head.startsWith('{')) {
    try {
      const evt = JSON.parse(raw) as {
        result?: { task?: unknown };
        error?: { code?: number; message?: string; data?: unknown };
      };
      if (evt.error) {
        throw new A2aRpcError(`${evt.error.code ?? ''} ${evt.error.message ?? 'RPC error'}`.trim(), {
          code: evt.error.code,
          rpcMessage: evt.error.message,
          data: evt.error.data,
        });
      }
      if (evt.result?.task) return evt.result.task;
    } catch (e) {
      if (e instanceof A2aRpcError) throw e;
      // Fall through to SSE parsing.
    }
  }
  const lines = raw.split('\n');
  let latestTask: unknown = null;
  let lastError: A2aRpcError | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    try {
      const evt = JSON.parse(payload) as {
        result?: { task?: unknown };
        error?: { code?: number; message?: string; data?: unknown };
      };
      if (evt.error) {
        lastError = new A2aRpcError(
          `${evt.error.code ?? ''} ${evt.error.message ?? 'RPC error'}`.trim(),
          { code: evt.error.code, rpcMessage: evt.error.message, data: evt.error.data }
        );
      }
      if (evt.result?.task) latestTask = evt.result.task;
    } catch {
      // Ignore malformed stream line and keep best-effort parsing.
    }
  }
  if (lastError) throw lastError;
  if (latestTask) return latestTask;
  throw new A2aRpcError('SendStreamingMessage returned no task payload (expected SSE data lines or JSON result.task).', {
    rpcMessage: 'empty_stream_task',
  });
}

function normalizeToken(token?: string | null): string | null {
  if (!token) return null;
  return token.trim().replace(/^['"]|['"]$/g, '');
}

function normalizeTaskSubmit(input: unknown): A2aTaskSubmitResponse {
  const root = (input ?? {}) as Record<string, unknown>;
  const o = ((root.task as Record<string, unknown> | undefined) ?? root) as Record<string, unknown>;
  const idRaw = o.taskId ?? o.task_id ?? o.id ?? o.requestId;
  if (idRaw === undefined || idRaw === null || String(idRaw).trim() === '') {
    throw new Error('Remote agent response is missing a task id; cannot call GetTask.');
  }
  const taskId = String(idRaw).trim();
  const sessionId =
    String(
      o.sessionId ??
        o.session_id ??
        o.contextId ??
        o.context_id ??
        o.threadId ??
        o.thread_id ??
        taskId
    );
  const statusObj = o.status as Record<string, unknown> | undefined;
  const statusRaw = String(statusObj?.state ?? o.status ?? 'queued').toLowerCase();
  const status: A2aTaskSubmitResponse['status'] =
    statusRaw.includes('completed')
      ? 'completed'
      : statusRaw.includes('failed') || statusRaw.includes('rejected')
        ? 'failed'
        : statusRaw.includes('cancelled') || statusRaw.includes('canceled')
          ? 'cancelled'
          : statusRaw.includes('input_required')
            ? 'input_required'
            : statusRaw.includes('auth_required')
              ? 'auth_required'
        : statusRaw.includes('running') || statusRaw.includes('working')
          ? 'running'
          : 'queued';
  const traceId = o.traceId ?? o.trace_id;
  const metadata =
    ((o.metadata as Record<string, unknown> | undefined) ??
      (root.metadata as Record<string, unknown> | undefined)) || {};
  const authRaw = (metadata.auth as Record<string, unknown> | undefined) || {};
  const fromParts = (parts: unknown): string => {
    if (!Array.isArray(parts)) return '';
    return (parts as unknown[])
      .map((p) => {
        const pp = p as Record<string, unknown>;
        if (typeof pp.text === 'string') return pp.text;
        if (typeof pp.content === 'string') return pp.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  };
  const statusMsg = statusObj?.message as Record<string, unknown> | undefined;
  const output = fromParts(statusMsg?.parts);
  return {
    taskId,
    sessionId,
    status,
    traceId: typeof traceId === 'string' ? traceId : undefined,
    output: output || undefined,
    auth: {
      type: typeof authRaw.type === 'string' ? authRaw.type : undefined,
      provider: typeof authRaw.provider === 'string' ? authRaw.provider : undefined,
      authorizationUrl: typeof authRaw.authorizationUrl === 'string' ? authRaw.authorizationUrl : undefined,
      tokenUrl: typeof authRaw.tokenUrl === 'string' ? authRaw.tokenUrl : undefined,
      scopes: Array.isArray(authRaw.scopes)
        ? authRaw.scopes.filter((x): x is string => typeof x === 'string')
        : undefined,
      instructions: typeof authRaw.instructions === 'string' ? authRaw.instructions : undefined,
    },
  };
}

function normalizeTaskResult(input: unknown, fallback: { taskId: string; sessionId?: string }): A2aTaskResult {
  const root = (input ?? {}) as Record<string, unknown>;
  const o = ((root.task as Record<string, unknown> | undefined) ?? root) as Record<string, unknown>;
  const taskId = String(o.taskId ?? o.task_id ?? o.id ?? fallback.taskId);
  const resolvedSessionId = String(
    o.sessionId ??
      o.session_id ??
      o.contextId ??
      o.context_id ??
      fallback.sessionId ??
      taskId
  );
  const statusObj = o.status as Record<string, unknown> | undefined;
  const statusRaw = String(statusObj?.state ?? o.status ?? 'running').toLowerCase();
  const status: A2aTaskResult['status'] =
    statusRaw.includes('completed')
      ? 'completed'
      : statusRaw.includes('failed') || statusRaw.includes('rejected')
        ? 'failed'
        : statusRaw.includes('cancelled') || statusRaw.includes('canceled')
          ? 'cancelled'
          : statusRaw.includes('input_required')
            ? 'input_required'
            : statusRaw.includes('auth_required')
              ? 'auth_required'
        : statusRaw.includes('queued')
          ? 'queued'
          : 'running';

  const fromParts = (parts: unknown): string => {
    if (!Array.isArray(parts)) return '';
    return (parts as unknown[])
      .map((p) => {
        const pp = p as Record<string, unknown>;
        if (typeof pp.text === 'string') return pp.text;
        if (typeof pp.content === 'string') return pp.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  };

  const statusMsg = statusObj?.message as Record<string, unknown> | undefined;
  const statusMsgText = fromParts(statusMsg?.parts);
  const artifacts = o.artifacts as unknown[] | undefined;
  const artifactText =
    Array.isArray(artifacts)
      ? artifacts
          .map((a) => fromParts((a as Record<string, unknown>).parts))
          .filter(Boolean)
          .join('\n')
      : '';
  const output =
    typeof o.output === 'string'
      ? o.output
      : typeof o.result === 'string'
        ? o.result
        : typeof o.message === 'string'
          ? o.message
          : typeof (o.output as Record<string, unknown> | undefined)?.text === 'string'
            ? String((o.output as Record<string, unknown>).text)
            : typeof (o.result as Record<string, unknown> | undefined)?.text === 'string'
              ? String((o.result as Record<string, unknown>).text)
              : Array.isArray(o.messages)
                ? (o.messages as unknown[])
                    .map((m) => {
                      const mm = m as Record<string, unknown>;
                      if (typeof mm.text === 'string') return mm.text;
                      if (typeof mm.content === 'string') return mm.content;
                      return '';
                    })
                    .filter(Boolean)
                    .join('\n')
                : statusMsgText || artifactText || undefined;
  const metadata =
    ((o.metadata as Record<string, unknown> | undefined) ??
      (root.metadata as Record<string, unknown> | undefined)) || {};
  const subscription = parseMetadataSubscription(metadata);
  const authRaw = (metadata.auth as Record<string, unknown> | undefined) || {};

  const statusTs = statusObj?.timestamp;
  let remoteUpdatedAtMs: number | undefined;
  if (typeof statusTs === 'string') {
    const parsed = Date.parse(statusTs);
    if (!Number.isNaN(parsed)) remoteUpdatedAtMs = parsed;
  } else if (typeof statusTs === 'number' && Number.isFinite(statusTs)) {
    remoteUpdatedAtMs = statusTs;
  }

  return {
    taskId,
    sessionId: resolvedSessionId,
    status,
    output: output && output.trim() ? output.trim() : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
    traceId: typeof (o.traceId ?? o.trace_id) === 'string' ? String(o.traceId ?? o.trace_id) : undefined,
    auth: {
      type: typeof authRaw.type === 'string' ? authRaw.type : undefined,
      provider: typeof authRaw.provider === 'string' ? authRaw.provider : undefined,
      authorizationUrl: typeof authRaw.authorizationUrl === 'string' ? authRaw.authorizationUrl : undefined,
      tokenUrl: typeof authRaw.tokenUrl === 'string' ? authRaw.tokenUrl : undefined,
      scopes: Array.isArray(authRaw.scopes)
        ? authRaw.scopes.filter((x): x is string => typeof x === 'string')
        : undefined,
      instructions: typeof authRaw.instructions === 'string' ? authRaw.instructions : undefined,
    },
    ...(subscription ? { subscription } : {}),
    ...(remoteUpdatedAtMs !== undefined ? { remoteUpdatedAtMs } : {}),
  };
}

export class MockA2AProvider implements RemoteAgentProvider {
  async connect(config: A2aProviderConfig): Promise<A2aConnectResult> {
    const effective = { ...config, token: normalizeToken(config.token) };
    try {
      const connectHeaders: Record<string, string> = {};
      if (effective.pushChannel) connectHeaders['x-a2a-push-channel'] = effective.pushChannel;
      if (effective.pushToken) connectHeaders['x-a2a-push-token'] = effective.pushToken;
      const cacheKey = config.baseUrl.trim().replace(/\/+$/, '');
      const discoveryBase = gatewayRootForAgentDiscovery(config.baseUrl);
      const fetchConfig: A2aProviderConfig = { ...effective, baseUrl: discoveryBase };
      const card = await fetchJson<DiscoveryCard>(fetchConfig, '/.well-known/agent-card.json', {
        method: 'GET',
        headers: connectHeaders,
      }).catch(async () =>
        fetchJson<DiscoveryCard>(fetchConfig, '/.well-known/agent.json', {
          method: 'GET',
          headers: connectHeaders,
        })
      );

      const iface = (card.supportedInterfaces ?? []).find(
        (x) => String(x.protocolBinding || '').toUpperCase() === 'JSONRPC'
      );
      const protocolVersion = (
        iface?.protocolVersion ||
        card.protocolVersion ||
        card.protocol?.version ||
        '0'
      ).toString();
      const supportedModalities = card.supportedModalities ?? card.capabilities?.modalities ?? ['text'];
      const supportedTools = card.supportedTools ?? card.capabilities?.tools ?? [];
      const tags = (card.skills ?? []).flatMap((s) => s.tags ?? []);
      const limits = card.limits ?? { streaming: card.capabilities?.streaming };
      let rpcUrl = iface?.url || card.url || card.endpoints?.rpc || '';
      if (/\/a2a\/v1\/[^/]+$/i.test(cacheKey)) {
        rpcUrl = cacheKey;
      }

      if (protocolVersion !== '1.0') {
        return { ok: false, error: `Incompatible protocol version ${protocolVersion}. Expected 1.x` };
      }
      if (!supportedModalities.includes('text')) {
        return { ok: false, error: 'Agent does not support text modality.' };
      }
      if (!rpcUrl) {
        return { ok: false, error: 'Agent Card missing JSON-RPC endpoint (`url`/`endpoints.rpc`).' };
      }
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H1-H3',location:'lib/a2a/mockProvider.ts:connect',message:'resolved rpc endpoint from card',data:{cacheKey,rpcUrl,protocolVersion},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      RPC_ENDPOINT_BY_BASE[cacheKey] = rpcUrl;
      PROTOCOL_VERSION_BY_BASE[cacheKey] = protocolVersion;
      STREAMING_SUPPORTED_BY_BASE[cacheKey] = Boolean(limits.streaming ?? card.capabilities?.streaming);
      return {
        ok: true,
        metadata: { protocolVersion, supportedModalities, supportedTools, limits, tags },
      };
    } catch (e) {
      return { ok: false, error: normalizeError(e).message };
    }
  }

  async submitTask(config: A2aProviderConfig, input: A2aTaskInput): Promise<A2aTaskSubmitResponse> {
    const effective = { ...config, token: normalizeToken(config.token) };
    const base = config.baseUrl.replace(/\/+$/, '');
    if (PROTOCOL_VERSION_BY_BASE[base] && PROTOCOL_VERSION_BY_BASE[base] !== '1.0') {
      throw new Error(`Incompatible protocol version ${PROTOCOL_VERSION_BY_BASE[base]}. Expected 1.0`);
    }
    let attempt = 0;
    const max = Math.max(0, config.retryCount);
    while (true) {
      try {
        if (input.oauthAccessToken) {
          // Debug-only: confirm token is being attached to A2A continuation.
          // eslint-disable-next-line no-console
          console.log('[A2A][oauth] attaching token to SendMessage:', maskToken(input.oauthAccessToken));
        } else {
          // eslint-disable-next-line no-console
          console.log('[A2A][oauth] no oauthAccessToken attached to SendMessage');
        }
        const payload = {
          message: {
            role: 'ROLE_USER',
            parts: [{ text: input.userMessage }],
            metadata: {
              ...(input.metadata ?? {}),
              ...(input.oauthAccessToken ? { oauthAccessToken: input.oauthAccessToken } : {}),
            },
          },
          taskId: input.taskId,
          contextId: input.contextId,
          referenceTaskIds: input.referenceTaskIds ?? [],
          oauthAccessToken: input.oauthAccessToken,
          credentials: input.oauthAccessToken ? { accessToken: input.oauthAccessToken } : undefined,
          context: input.context,
          metadata: input.metadata ?? {},
          ...(input.configuration ? { configuration: input.configuration } : {}),
        };
        // returnImmediately must use JSON-RPC SendMessage (or JSON body); streaming path is SSE-only on many agents.
        const returnImmediately = Boolean(input.configuration?.returnImmediately);
        const raw =
          STREAMING_SUPPORTED_BY_BASE[base] && !returnImmediately
            ? await rpcStreamSendMessage(effective, payload)
            : await rpcCall<unknown>(effective, 'SendMessage', payload);
        return normalizeTaskSubmit(raw);
      } catch (e) {
        const n = normalizeError(e);
        if (!n.retryable || attempt >= max) throw new Error(n.message);
        attempt += 1;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }

  async pollTask(
    config: A2aProviderConfig,
    args: { taskId: string; contextId?: string; correlationId?: string }
  ): Promise<A2aTaskResult> {
    const effective = { ...config, token: normalizeToken(config.token) };
    const base = config.baseUrl.replace(/\/+$/, '');
    if (PROTOCOL_VERSION_BY_BASE[base] && PROTOCOL_VERSION_BY_BASE[base] !== '1.0') {
      throw new Error(`Incompatible protocol version ${PROTOCOL_VERSION_BY_BASE[base]}. Expected 1.0`);
    }
    const raw = await rpcCall<unknown>(effective, 'GetTask', {
      taskId: args.taskId,
      id: args.taskId,
      contextId: args.contextId,
      correlationId: args.correlationId,
    });
    return normalizeTaskResult(raw, { taskId: args.taskId, sessionId: args.contextId });
  }

  async cancelTask(
    config: A2aProviderConfig,
    args: { taskId: string; contextId?: string; correlationId?: string }
  ): Promise<void> {
    const effective = { ...config, token: normalizeToken(config.token) };
    const base = config.baseUrl.replace(/\/+$/, '');
    if (PROTOCOL_VERSION_BY_BASE[base] && PROTOCOL_VERSION_BY_BASE[base] !== '1.0') {
      throw new Error(`Incompatible protocol version ${PROTOCOL_VERSION_BY_BASE[base]}. Expected 1.0`);
    }
    await rpcCall(effective, 'CancelTask', {
      taskId: args.taskId,
      id: args.taskId,
      contextId: args.contextId,
      correlationId: args.correlationId,
    });
  }

  async setTaskPushNotificationConfig(
    config: A2aProviderConfig,
    args: { taskId: string; pushNotificationConfig: A2aPushNotificationConfig }
  ): Promise<void> {
    const effective = { ...config, token: normalizeToken(config.token) };
    await rpcCall(effective, 'tasks/pushNotificationConfig/set', {
      id: args.taskId,
      taskId: args.taskId,
      pushNotificationConfig: args.pushNotificationConfig,
    });
  }

  async getTaskPushNotificationConfig(
    config: A2aProviderConfig,
    args: { taskId: string }
  ): Promise<A2aPushNotificationConfig | null> {
    const effective = { ...config, token: normalizeToken(config.token) };
    const res = await rpcCall<{ pushNotificationConfig?: A2aPushNotificationConfig }>(
      effective,
      'tasks/pushNotificationConfig/get',
      {
        id: args.taskId,
        taskId: args.taskId,
      }
    );
    return res?.pushNotificationConfig ?? null;
  }

  async listTasks(config: A2aProviderConfig): Promise<A2aTaskResult[]> {
    const effective = { ...config, token: normalizeToken(config.token) };
    const res = await rpcCall<{ tasks?: unknown[] }>(effective, 'ListTasks', {});
    const tasks = Array.isArray(res?.tasks) ? res.tasks : [];
    return tasks.map((t) => normalizeTaskResult(t, { taskId: '' })).filter((t) => !!t.taskId);
  }
}
