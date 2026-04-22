import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { logA2aHop } from '@/lib/a2a/store';
import { refreshAllActiveSubscriptionFeeds } from '@/lib/subscriptionUpdatesFeed';

const POLL_MS = 22_000;
const NET_DEBOUNCE_MS = 2500;

let intervalId: ReturnType<typeof setInterval> | null = null;
let netUnsub: (() => void) | null = null;
let appSub: { remove: () => void } | null = null;
let lastNetRefreshAt = 0;

function isOnline(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): boolean {
  if (state.isConnected !== true) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

async function runSubscriptionSync(_source: string): Promise<void> {
  await logA2aHop({
    level: 'info',
    hop: 'autosync.run.start',
    status: 'running',
    detail: { source: _source, appState: AppState.currentState },
  }).catch(() => {});
  try {
    await refreshAllActiveSubscriptionFeeds();
    await logA2aHop({
      level: 'info',
      hop: 'autosync.run.success',
      status: 'completed',
      detail: { source: _source },
    }).catch(() => {});
  } catch {
    await logA2aHop({
      level: 'error',
      hop: 'autosync.run.error',
      status: 'failed',
      detail: { source: _source },
    }).catch(() => {});
    // best-effort; next interval / foreground will retry
  }
}

/**
 * While the user is signed in: poll subscription state on an interval when the app is active,
 * and run a full sync when the device regains connectivity.
 */
export function registerSubscriptionAutoSync(): () => void {
  // Defensive singleton: avoid accumulating duplicate listeners on remount/re-register.
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  netUnsub?.();
  netUnsub = null;
  appSub?.remove();
  appSub = null;

  const clearPoll = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const startPoll = () => {
    clearPoll();
    intervalId = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void NetInfo.fetch().then((s) => {
        if (isOnline(s)) void runSubscriptionSync('interval');
      });
    }, POLL_MS);
  };

  const localNetUnsub = NetInfo.addEventListener((state) => {
    void logA2aHop({
      level: 'info',
      hop: 'autosync.net.change',
      status: 'running',
      detail: { isConnected: state.isConnected, isInternetReachable: state.isInternetReachable },
    }).catch(() => {});
    if (!isOnline(state)) return;
    const now = Date.now();
    if (now - lastNetRefreshAt < NET_DEBOUNCE_MS) return;
    lastNetRefreshAt = now;
    void runSubscriptionSync('net-reachable');
  });

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') {
      startPoll();
      void NetInfo.fetch().then((s) => {
        if (isOnline(s)) void runSubscriptionSync('app-active');
      });
    } else {
      clearPoll();
    }
  };

  const localAppSub = AppState.addEventListener('change', onAppState);
  netUnsub = localNetUnsub;
  appSub = localAppSub;

  if (AppState.currentState === 'active') {
    startPoll();
    void NetInfo.fetch().then((s) => {
      if (isOnline(s)) void runSubscriptionSync('register');
    });
  }

  return () => {
    clearPoll();
    localNetUnsub();
    localAppSub.remove();
    if (netUnsub === localNetUnsub) netUnsub = null;
    if (appSub === localAppSub) appSub = null;
  };
}
