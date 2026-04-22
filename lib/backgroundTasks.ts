import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import {
  getBackgroundFetchEnabled,
  getBackgroundNotificationText,
  getNotificationsEnabled,
} from '@/lib/appSettings';
import { ensureAndroidChannel, ensureNotificationPermissions } from '@/lib/notifications';
import { refreshAllActiveSubscriptionFeeds } from '@/lib/subscriptionUpdatesFeed';

export const BACKGROUND_FETCH_TASK = 'mcp-manager-background-fetch';

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const [bgOn, notifyOn] = await Promise.all([
      getBackgroundFetchEnabled(),
      getNotificationsEnabled(),
    ]);
    if (!bgOn || !notifyOn) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    const granted = await ensureNotificationPermissions();
    if (!granted) {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
    await refreshAllActiveSubscriptionFeeds();
    await ensureAndroidChannel();
    const body = await getBackgroundNotificationText();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Background sync',
        body,
      },
      trigger: null,
    });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundFetch(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
  if (registered) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
  }
  await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 15 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterBackgroundFetch(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
  if (registered) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
  }
}
