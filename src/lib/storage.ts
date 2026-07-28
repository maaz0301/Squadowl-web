import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * Web counterpart of the app's MMKV store. Same synchronous key/value surface,
 * backed by localStorage, with an in-memory fallback so imports are safe during
 * server rendering.
 */
const memory = new Map<string, string>();

const hasWindow = () => typeof window !== 'undefined' && !!window.localStorage;

const PREFIX = 'aas-web:';

export const storage = {
  getString(key: string): string | undefined {
    if (!hasWindow()) return memory.get(key);
    return window.localStorage.getItem(PREFIX + key) ?? undefined;
  },
  set(key: string, value: string): void {
    if (!hasWindow()) {
      memory.set(key, value);
      return;
    }
    window.localStorage.setItem(PREFIX + key, value);
  },
  remove(key: string): void {
    if (!hasWindow()) {
      memory.delete(key);
      return;
    }
    window.localStorage.removeItem(PREFIX + key);
  },
};

export const webStorage: StateStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.remove(name),
};

export const zustandStorage = createJSONStorage(() => webStorage);

export const KV_KEYS = {
  DB: 'aas_db_v1',
  AUTH: 'aas_auth',
  ONBOARDING: 'aas_onboarding',
} as const;

export function getJson<T>(key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}
