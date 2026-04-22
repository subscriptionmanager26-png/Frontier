import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'frontier_mcp_active_server_id';

export async function getActiveServerId(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function setActiveServerId(id: string | null): Promise<void> {
  if (!id) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, id);
}
