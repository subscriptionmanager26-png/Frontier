import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { hasSupabaseConfig, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';

const MODEL_KEY = 'settings_openai_model';
const NOTIFY_KEY = 'settings_notifications_enabled';
const BG_FETCH_KEY = 'settings_background_fetch_enabled';
const BG_LABEL_KEY = 'settings_background_notification_text';
const AZURE_URL_KEY = 'settings_azure_chat_url';
const A2A_TIMEOUT_MS_KEY = 'settings_a2a_timeout_ms';
const A2A_RETRY_COUNT_KEY = 'settings_a2a_retry_count';
const CHAT_KEYBOARD_DIAG_KEY = 'settings_chat_keyboard_diag_log';

const SECURE_OPENAI_KEY = 'openai_api_key';
const SECURE_AZURE_KEY = 'azure_openai_api_key';
const SECURE_ANTHROPIC_KEY = 'anthropic_api_key';
const SECURE_A2A_TOKEN = 'a2a_auth_token';
const SECURE_A2A_TASK_PUSH_WEBHOOK_BEARER = 'a2a_task_push_webhook_bearer';

const DEFAULT_A2A_TOKEN = 'dev-a2a-key';

/**
 * Optional pretty origin for JSON-RPC (`{origin}/a2a/v1/{slug}`), e.g. Vercel custom domain.
 * When unset, callers use the Supabase Edge Function URL from `EXPO_PUBLIC_SUPABASE_URL`.
 */
export function getPublicA2aGatewayBaseUrlSync(): string {
  const fromEnv = process.env.EXPO_PUBLIC_A2A_GATEWAY_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
  const v = extra.EXPO_PUBLIC_A2A_GATEWAY_PUBLIC_BASE_URL;
  return typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
}

/** JSON-RPC base: `{this}/a2a/v1/{slug}` — public domain when configured, else Supabase `a2a-gateway`. */
export function getEmbeddedA2aGatewayBaseUrl(): string {
  const pub = getPublicA2aGatewayBaseUrlSync();
  if (pub) return pub;
  if (!hasSupabaseConfig || !SUPABASE_URL) return '';
  return `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/a2a-gateway`;
}

function getEmbeddedA2aEmissionsUrl(): string {
  if (!hasSupabaseConfig || !SUPABASE_URL) return '';
  return `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/a2a-emissions`;
}

export async function getOpenAiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_OPENAI_KEY);
  } catch {
    return null;
  }
}

export async function setOpenAiKey(key: string | null): Promise<void> {
  if (!key?.trim()) {
    try {
      await SecureStore.deleteItemAsync(SECURE_OPENAI_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(SECURE_OPENAI_KEY, key.trim());
}

export async function getAzureOpenAiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_AZURE_KEY);
  } catch {
    return null;
  }
}

export async function getAnthropicKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_ANTHROPIC_KEY);
  } catch {
    return null;
  }
}

export async function setAnthropicKey(key: string | null): Promise<void> {
  if (!key?.trim()) {
    try {
      await SecureStore.deleteItemAsync(SECURE_ANTHROPIC_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(SECURE_ANTHROPIC_KEY, key.trim());
}

/**
 * JSON-RPC base for the shared A2A gateway (`{base}/a2a/v1/{slug}`).
 * Comes from bundled `EXPO_PUBLIC_SUPABASE_URL` — no manual entry.
 */
export async function getA2aBaseUrl(): Promise<string> {
  return getEmbeddedA2aGatewayBaseUrl();
}

/** Kept for API compatibility; URL is always embedded from app config. */
export async function setA2aBaseUrl(_url: string): Promise<void> {}

/**
 * Bearer used for `Authorization` on A2A HTTP calls to this project’s Edge Functions.
 * Uses the bundled anon key (same as `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
 */
export async function getA2aToken(): Promise<string | null> {
  if (hasSupabaseConfig && SUPABASE_ANON_KEY) {
    return SUPABASE_ANON_KEY;
  }
  try {
    return (await SecureStore.getItemAsync(SECURE_A2A_TOKEN)) || DEFAULT_A2A_TOKEN;
  } catch {
    return DEFAULT_A2A_TOKEN;
  }
}

/** Kept for API compatibility; token is embedded from app config when Supabase is configured. */
export async function setA2aToken(_token: string | null): Promise<void> {}

export async function getA2aTimeoutMs(): Promise<number> {
  const raw = await AsyncStorage.getItem(A2A_TIMEOUT_MS_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? n : 15000;
}

export async function setA2aTimeoutMs(ms: number): Promise<void> {
  const safe = Number.isFinite(ms) && ms >= 1000 ? Math.round(ms) : 15000;
  await AsyncStorage.setItem(A2A_TIMEOUT_MS_KEY, String(safe));
}

export async function getA2aRetryCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(A2A_RETRY_COUNT_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(5, Math.round(n)) : 1;
}

export async function setA2aRetryCount(count: number): Promise<void> {
  const safe = Number.isFinite(count) && count >= 0 ? Math.min(5, Math.round(count)) : 1;
  await AsyncStorage.setItem(A2A_RETRY_COUNT_KEY, String(safe));
}

/** Backend URL for A2A task push webhooks (subscription emissions). Bundled project `a2a-emissions` function. */
export async function getA2aTaskPushWebhookUrl(): Promise<string> {
  return getEmbeddedA2aEmissionsUrl();
}

export async function setA2aTaskPushWebhookUrl(_url: string): Promise<void> {}

export async function getA2aTaskPushWebhookBearer(): Promise<string> {
  if (hasSupabaseConfig && SUPABASE_ANON_KEY) {
    return SUPABASE_ANON_KEY;
  }
  try {
    return (await SecureStore.getItemAsync(SECURE_A2A_TASK_PUSH_WEBHOOK_BEARER)) || '';
  } catch {
    return '';
  }
}

export async function setA2aTaskPushWebhookBearer(_token: string | null): Promise<void> {}

export async function setAzureOpenAiKey(key: string | null): Promise<void> {
  if (!key?.trim()) {
    try {
      await SecureStore.deleteItemAsync(SECURE_AZURE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(SECURE_AZURE_KEY, key.trim());
}

export async function getAzureChatCompletionsUrl(): Promise<string> {
  const v = await AsyncStorage.getItem(AZURE_URL_KEY);
  return v || '';
}

export async function setAzureChatCompletionsUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(AZURE_URL_KEY, url.trim());
}

export async function getOpenAiModel(): Promise<string> {
  const v = await AsyncStorage.getItem(MODEL_KEY);
  return v || 'gpt-4o-mini';
}

export async function setOpenAiModel(model: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, model);
}

export async function getNotificationsEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(NOTIFY_KEY)) === '1';
}

export async function setNotificationsEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
}

export async function getBackgroundFetchEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(BG_FETCH_KEY)) === '1';
}

export async function setBackgroundFetchEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_FETCH_KEY, on ? '1' : '0');
}

export async function getBackgroundNotificationText(): Promise<string> {
  return (await AsyncStorage.getItem(BG_LABEL_KEY)) || 'Scheduled check-in';
}

export async function setBackgroundNotificationText(text: string): Promise<void> {
  await AsyncStorage.setItem(BG_LABEL_KEY, text.trim() || 'Scheduled check-in');
}

export async function getChatKeyboardDiagLog(): Promise<boolean> {
  return (await AsyncStorage.getItem(CHAT_KEYBOARD_DIAG_KEY)) === '1';
}

export async function setChatKeyboardDiagLog(on: boolean): Promise<void> {
  await AsyncStorage.setItem(CHAT_KEYBOARD_DIAG_KEY, on ? '1' : '0');
}
