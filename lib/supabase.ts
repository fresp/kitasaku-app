import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// expo-secure-store tidak punya implementasi web (stub-nya kosong), jadi di web
// sesi disimpan di localStorage supaya login tetap bisa diuji lewat browser.
function createStorageAdapter() {
  if (Platform.OS === 'web') {
    return {
      getItem: (key: string) => {
        try {
          return Promise.resolve(globalThis.localStorage?.getItem(key) ?? null);
        } catch {
          return Promise.resolve(null);
        }
      },
      setItem: (key: string, value: string) => {
        try {
          globalThis.localStorage?.setItem(key, value);
        } catch {
          // localStorage bisa diblokir (private mode) — abaikan, sesi jadi tidak persisten
        }
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        try {
          globalThis.localStorage?.removeItem(key);
        } catch {
          // diabaikan
        }
        return Promise.resolve();
      },
    };
  }
  return {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: createStorageAdapter() as any,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Isi EXPO_PUBLIC_SUPABASE_URL dan EXPO_PUBLIC_SUPABASE_ANON_KEY di file .env'
    );
  }
  return supabase;
}
