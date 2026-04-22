import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { a2aService } from '@/lib/a2a/service';
import { getA2aBaseUrl, getA2aRetryCount, getA2aTimeoutMs, getA2aToken, getA2aTaskPushWebhookUrl } from '@/lib/appSettings';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  return final === 'granted';
}

export async function scheduleTestNotification(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const ok = await ensureNotificationPermissions();
  if (!ok) return null;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Frontier',
      body: 'Notifications are working.',
    },
    trigger: null,
  });
  return id;
}

export function getAndroidChannelId(): string {
  return 'default';
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function getCurrentExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
    if (!projectId) return null;
    const ok = await ensureNotificationPermissions();
    if (!ok) return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token || null;
  } catch {
    return null;
  }
}

export async function registerPushTokenForTask(taskId: string): Promise<void> {
  const token = await getCurrentExpoPushToken();
  if (!token) throw new Error('Push token unavailable - check eas.projectId');
  const [baseUrl, authToken, timeoutMs, retryCount, webhookUrl] = await Promise.all([
    getA2aBaseUrl(),
    getA2aToken(),
    getA2aTimeoutMs(),
    getA2aRetryCount(),
    getA2aTaskPushWebhookUrl(),
  ]);
  if (!baseUrl.trim() || !webhookUrl.trim()) return;
  await a2aService.setTaskPushNotificationConfig({
    config: {
      baseUrl: baseUrl.trim(),
      token: authToken?.trim() || null,
      timeoutMs,
      retryCount,
    },
    taskId,
    pushNotificationConfig: {
      url: webhookUrl.trim(),
      authentication: {
        schemes: ['bearer'],
        credentials: token,
      },
    },
  });
}
