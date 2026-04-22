/**
 * Debounced cloud sync for A2A local state. Uses a dynamic import to avoid import cycles
 * with `cloudA2aState` → `store` / `subscriptionUpdatesFeed`.
 */
let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleCloudA2aStatePush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void import('@/lib/cloudA2aState')
      .then((m) => m.pushA2aDeviceStateToCloud())
      .catch(() => {});
  }, 2500);
}
