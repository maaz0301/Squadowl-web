'use client';

import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AppThemeProvider } from '@/theme/ThemeProvider';
import { AlertProvider } from '@/components/ui';
import { SessionExpiryNotice } from '@/components/SessionExpiryNotice';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';

/**
 * How long a foregrounded tab may go on trusting the profile it already holds
 * before re-reading it. Long enough that flicking between tabs costs nothing,
 * short enough that a change of role or plan lands within a session.
 */
const PROFILE_REFRESH_INTERVAL_MS = 60_000;

/** Pulls the persisted Supabase session forward on first load, like the app's boot. */
function SessionBootstrap() {
  useEffect(() => {
    useAuthStore.getState().restoreSession();
  }, []);

  // That boot read happens exactly once, and the data source caches the
  // profile for the lifetime of the tab — so a tab left open for days (phone
  // browsers and installed PWAs routinely keep one alive that long) goes on
  // serving whatever role and plan were true when it was first opened. The
  // drift is not cosmetic: role decides which navigation renders and whether
  // billing is reachable, so one device sat on a months-old role showing an
  // Upgrade button while a freshly loaded browser on the same account showed
  // the guardian portal with no way to upgrade at all. Reconcile whenever the
  // tab comes back to the foreground, which is the cheapest moment that
  // reliably precedes the user acting on what they see.
  useEffect(() => {
    let lastRefreshedAt = Date.now();
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshedAt < PROFILE_REFRESH_INTERVAL_MS) return;
      lastRefreshedAt = Date.now();
      void useAuthStore.getState().refreshProfile();
    };
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
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
