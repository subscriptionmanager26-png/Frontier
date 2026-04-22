import { DeviceEventEmitter } from 'react-native';

/** Debounced signal for Tasks, Updates, Direct list, etc. to reload from local DB / AsyncStorage. */
export const FRONTIER_A2A_UI_REFRESH = 'frontier_a2a_ui_refresh';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function requestA2aUiRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    DeviceEventEmitter.emit(FRONTIER_A2A_UI_REFRESH);
  }, 500);
}
