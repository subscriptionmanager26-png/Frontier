import type * as Notifications from 'expo-notifications';

import { getChatMemoryDb } from '@/lib/chatMemory';

export type NotificationLogRow = {
  id: string;
  notificationIdentifier: string;
  title: string | null;
  body: string | null;
  dataJson: string;
  receivedAt: number;
  openedAt: number | null;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function safeJson(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
}

function toMillis(ts?: number): number {
  if (!ts) return Date.now();
  // Expo trigger dates can be in seconds in some cases.
  return ts > 1e12 ? ts : ts * 1000;
}

function readContent(notification: Notifications.Notification) {
  const content = notification.request.content;
  return {
    title: content.title ?? null,
    body: content.body ?? null,
    dataJson: safeJson(content.data),
  };
}

export async function upsertNotificationReceived(
  notification: Notifications.Notification
): Promise<void> {
  const db = await getChatMemoryDb();
  const identifier = notification.request.identifier;
  const { title, body, dataJson } = readContent(notification);
  const receivedAt = toMillis(notification.date);

  await db.runAsync(
    `INSERT INTO notification_log
      (id, notification_identifier, title, body, data_json, received_at, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(notification_identifier) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       data_json = excluded.data_json,
       received_at = CASE
         WHEN notification_log.received_at > excluded.received_at THEN notification_log.received_at
         ELSE excluded.received_at
       END`,
    newId(),
    identifier,
    title,
    body,
    dataJson,
    receivedAt
  );
}

export async function markNotificationOpened(response: Notifications.NotificationResponse): Promise<void> {
  const db = await getChatMemoryDb();
  const notification = response.notification;
  const identifier = notification.request.identifier;
  const { title, body, dataJson } = readContent(notification);
  const receivedAt = toMillis(notification.date);
  const openedAt = Date.now();

  await db.runAsync(
    `INSERT INTO notification_log
      (id, notification_identifier, title, body, data_json, received_at, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(notification_identifier) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       data_json = excluded.data_json,
       received_at = CASE
         WHEN notification_log.received_at > excluded.received_at THEN notification_log.received_at
         ELSE excluded.received_at
       END,
       opened_at = CASE
         WHEN notification_log.opened_at IS NULL THEN excluded.opened_at
         ELSE notification_log.opened_at
       END`,
    newId(),
    identifier,
    title,
    body,
    dataJson,
    receivedAt,
    openedAt
  );
}

export async function listNotificationLog(limit = 100): Promise<NotificationLogRow[]> {
  const db = await getChatMemoryDb();
  const rows = await db.getAllAsync<{
    id: string;
    notification_identifier: string;
    title: string | null;
    body: string | null;
    data_json: string;
    received_at: number;
    opened_at: number | null;
  }>(
    `SELECT id, notification_identifier, title, body, data_json, received_at, opened_at
     FROM notification_log
     ORDER BY received_at DESC
     LIMIT ?`,
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    notificationIdentifier: r.notification_identifier,
    title: r.title,
    body: r.body,
    dataJson: r.data_json,
    receivedAt: r.received_at,
    openedAt: r.opened_at,
  }));
}

export async function clearNotificationLog(): Promise<void> {
  const db = await getChatMemoryDb();
  await db.runAsync(`DELETE FROM notification_log`);
}

/** First time user opens in-app detail for this notification, record opened_at if still null. */
export async function markNotificationDetailViewed(notificationIdentifier: string): Promise<void> {
  const db = await getChatMemoryDb();
  const openedAt = Date.now();
  await db.runAsync(
    `UPDATE notification_log SET opened_at = COALESCE(opened_at, ?) WHERE notification_identifier = ?`,
    openedAt,
    notificationIdentifier
  );
}
