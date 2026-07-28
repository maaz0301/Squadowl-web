import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '@/theme/tokens';
import { zustandStorage } from '@/lib/storage';

interface ThemeState {
  mode: ThemeMode | 'system';
  setMode: (mode: ThemeMode | 'system') => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'dark',
      setMode: (mode) => set({ mode }),
      toggle: () => {
        const current = get().mode;
        if (current === 'system') {
          set({ mode: 'dark' });
        } else {
          set({ mode: current === 'dark' ? 'light' : 'dark' });
        }
      },
    }),
    { name: 'aas-theme', storage: zustandStorage },
  ),
);
