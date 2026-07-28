'use client';

import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AppThemeProvider } from '@/theme/ThemeProvider';
import { AlertProvider } from '@/components/ui';
import { useAuthStore } from '@/state/authStore';

/** Pulls the persisted Supabase session forward on first load, like the app's boot. */
function SessionBootstrap() {
  useEffect(() => {
    useAuthStore.getState().restoreSession();
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <AlertProvider>
          <SessionBootstrap />
          {children}
        </AlertProvider>
      </AppThemeProvider>
    </QueryClientProvider>
  );
}
