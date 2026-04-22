import type {
  A2aPushNotificationConfig,
  A2aConnectResult,
  A2aTaskInput,
  A2aTaskResult,
  A2aTaskSubmitResponse,
} from '@/lib/a2a/types';

export type A2aProviderConfig = {
  baseUrl: string;
  token?: string | null;
  /** Sent as `X-Supabase-Access-Token` so the gateway can identify the sender for owner inbox. */
  supabaseAccessToken?: string | null;
  timeoutMs: number;
  retryCount: number;
  pushChannel?: string;
  pushToken?: string | null;
};

export interface RemoteAgentProvider {
  connect(config: A2aProviderConfig): Promise<A2aConnectResult>;
  submitTask(config: A2aProviderConfig, input: A2aTaskInput): Promise<A2aTaskSubmitResponse>;
  pollTask(
    config: A2aProviderConfig,
    args: { taskId: string; contextId?: string; correlationId?: string }
  ): Promise<A2aTaskResult>;
  cancelTask(
    config: A2aProviderConfig,
    args: { taskId: string; contextId?: string; correlationId?: string }
  ): Promise<void>;
  setTaskPushNotificationConfig(
    config: A2aProviderConfig,
    args: { taskId: string; pushNotificationConfig: A2aPushNotificationConfig }
  ): Promise<void>;
  getTaskPushNotificationConfig(
    config: A2aProviderConfig,
    args: { taskId: string }
  ): Promise<A2aPushNotificationConfig | null>;
  listTasks(config: A2aProviderConfig): Promise<A2aTaskResult[]>;
}
