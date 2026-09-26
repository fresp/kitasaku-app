import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function createStorageAdapter() {
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
