import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { storage } from './storage';
import { APP_CONFIG } from '@/config/app';

/**
 * localStorage-backed storage adapter for Supabase auth session persistence,
 * mirroring the app's MMKV adapter so both clients behave identically.
 */
const webAuthStorage = {
  getItem: (key: string): string | null => storage.getString(key) ?? null,
  setItem: (key: string, value: string): void => {
    storage.set(key, value);
  },
  removeItem: (key: string): void => {
    storage.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseAnonKey } = APP_CONFIG;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      );
    }
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: webAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Password-reset and invite links land on /reset-password, which reads
        // the token itself, so the client must not consume the URL hash.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
