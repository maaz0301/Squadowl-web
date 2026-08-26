'use client';

import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AppThemeProvider } from '@/theme/ThemeProvider';
import { AlertProvider } from '@/components/ui';
import { SessionExpiryNotice } from '@/components/SessionExpiryNotice';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';

/** Pulls the persisted Supabase session forward on first load, like the app's boot. */
function SessionBootstrap() {
  useEffect(() => {
    useAuthStore.getState().restoreSession();
  }, []);

  // A refresh token can die while the tab just sits there: autoRefreshToken
  // runs on a timer, and when the Auth server no longer has the token the SDK
  // signs out on its own. Without this the app keeps rendering the stale
  // session until the user clicks something and gets an error, so listen for
  // that sign-out and react to it immediately. expireSession() ignores the
  // event that logout() itself produces.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = getSupabase().auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') void useAuthStore.getState().expireSession();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // Supabase isn't configured in this environment — nothing to watch.
    }
    return () => unsubscribe?.();
  }, []);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <AlertProvider>
          <SessionBootstrap />
          <SessionExpiryNotice />
          {children}
        </AlertProvider>
      </AppThemeProvider>
    </QueryClientProvider>
  );
}
