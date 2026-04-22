export type A2aMetadata = {
  protocolVersion: string;
  supportedModalities: string[];
  supportedTools: string[];
  tags?: string[];
  limits: {
    maxPayloadBytes?: number;
    ratePerMinute?: number;
    streaming?: boolean;
  };
};

/**
 * Optional SendMessage configuration: long-lived subscription tasks should use
 * returnImmediately + a server webhook so TaskArtifactUpdateEvent deliveries are not lost.
 * See subscriptionConventions.ts in this folder.
 */
export type A2aSendMessageConfiguration = {
  returnImmediately?: boolean;
  taskPushNotificationConfig?: {
    url: string;
    authentication?: { scheme?: string; schemes?: string[]; credentials: string };
  };
  /**
   * Some A2A stacks only read `pushNotificationConfig` on SendMessage. When set, mirror the same
   * URL/auth as `taskPushNotificationConfig` so both names reach the agent.
   */
  pushNotificationConfig?: {
    url: string;
    authentication?: { scheme?: string; schemes?: string[]; credentials: string };
  };
};

export type A2aPushNotificationConfig = {
  url: string;
  authentication?: { scheme?: string; schemes?: string[]; credentials: string };
};

export type A2aTaskInput = {
  // `taskId` is only for strict continuation of interrupted tasks.
  taskId?: string;
  // We persist this as `sessionId` in app storage, but protocol-wise it is contextId.
  contextId?: string;
  referenceTaskIds?: string[];
  oauthAccessToken?: string;
  userMessage: string;
  context?: string;
  metadata?: {
    appVersion?: string;
    userIdHash?: string;
    correlationId?: string;
  };
  configuration?: A2aSendMessageConfiguration;
};

export type A2aTaskSubmitResponse = {
  taskId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'input_required' | 'auth_required' | 'completed' | 'failed' | 'cancelled';
  traceId?: string;
  output?: string;
  auth?: {
    type?: string;
    provider?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    instructions?: string;
  };
};

export type A2aTaskResult = {
  taskId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'input_required' | 'auth_required' | 'completed' | 'failed' | 'cancelled';
  /** Wall time from agent task status `timestamp` (ISO or ms), when provided. */
  remoteUpdatedAtMs?: number;
  output?: string;
  error?: string;
  traceId?: string;
  auth?: {
    type?: string;
    provider?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    instructions?: string;
  };
  /**
   * Convention on top of A2A: a subscription stays non-terminal (e.g. WORKING/working/running),
   * emits recurring updates (artifacts / output), and ends on CancelTask or natural completion.
   */
  subscription?: {
    isSubscription: boolean;
    /** ISO-8601 duration, e.g. PT24H (from agent metadata.interval). */
    interval?: string;
    /** ISO-8601 instant for next scheduled emission (metadata.next_emission_at). */
    nextEmissionAt?: string;
    cadenceMs?: number;
    startedAt?: string;
    endsAt?: string;
    /** Emission index; agents may send emission_count or runCount. */
    runCount?: number;
    unsubscribeTaskId?: string;
  };
};

export type A2aConnectResult = {
  ok: true;
  metadata: A2aMetadata;
} | {
  ok: false;
  error: string;
};

export type A2aNormalizedError = {
  code:
    | 'unavailable'
    | 'timeout'
    | 'auth'
    | 'incompatible'
    | 'rate_limited'
    | 'version_not_supported'
    | 'task_not_found'
    | 'task_not_cancelable'
    | 'unsupported_operation'
    | 'invalid_params'
    | 'parse_error'
    | 'method_not_found'
    | 'content_type_not_supported'
    | 'extension_required'
    | 'remote'
    | 'unknown';
  message: string;
  retryable: boolean;
};
