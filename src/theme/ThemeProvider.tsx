'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getThemeColors,
  themeTokens,
  type ThemeColors,
  type ThemeMode,
  type ThemeTokens,
} from './tokens';
import { useThemeStore } from '@/state/themeStore';

export interface AppTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  tokens: ThemeTokens;
  isDark: boolean;
}

const ThemeContext = createContext<AppTheme | null>(null);

/** Browser equivalent of RN's useColorScheme(). */
function useSystemColorScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => setScheme(mq.matches ? 'light' : 'dark');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return scheme;
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemeStore((s) => s.mode);
  const systemScheme = useSystemColorScheme();
  const mode: ThemeMode =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const value = useMemo<AppTheme>(
    () => ({
      mode,
      colors: getThemeColors(mode),
      tokens: themeTokens,
      isDark: mode === 'dark',
    }),
    [mode],
  );

  // Expose the palette as CSS variables so global styles (scrollbars, selection,
  // form controls) follow the same tokens the components use.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    for (const [key, val] of Object.entries(value.colors)) {
      root.style.setProperty(`--c-${key}`, val);
    }
  }, [mode, value.colors]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within AppThemeProvider');
  }
  return ctx;
}

export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}
