import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

function readExtra(key: string): string {
  const fromEnv = process.env[key];
  if (fromEnv?.trim()) return fromEnv.trim();
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
  const fromExtra = extra[key];
  return typeof fromExtra === 'string' ? fromExtra.trim() : '';
}

/** In-memory session during Expo Router static web render (Node has no `window`; AsyncStorage throws). */
function createSsrWebAuthStorage(): Pick<
  typeof AsyncStorage,
  'getItem' | 'setItem' | 'removeItem'
> {
  const mem = new Map<string, string>();
  return {
    getItem: async (key: string) => (mem.has(key) ? mem.get(key)! : null),
    setItem: async (key: string, value: string) => {
      mem.set(key, value);
    },
    removeItem: async (key: string) => {
      mem.delete(key);
    },
  };
}

function authStorageForCurrentEnvironment() {
  if (Platform.OS === 'web' && typeof window === 'undefined') {
    return createSsrWebAuthStorage();
  }
  return AsyncStorage;
}

export const SUPABASE_URL = readExtra('EXPO_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = readExtra('EXPO_PUBLIC_SUPABASE_ANON_KEY');

export const hasSupabaseConfig = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

export const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: authStorageForCurrentEnvironment(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
