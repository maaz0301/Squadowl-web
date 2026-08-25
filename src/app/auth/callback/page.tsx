'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, LoadingState } from '@/components/ui';

/**
 * Where signup/invite confirmation links land. The app turns off
 * detectSessionInUrl (see lib/supabase.ts) so the OTP-based password-reset
 * flow doesn't fight over the URL, which means nothing else auto-consumes a
 * confirmation link's token either — without this page that link would just
 * drop the browser on a blank tab. Handles both link shapes Supabase can
 * send: a `code` query param (PKCE) and `access_token`/`refresh_token` in
 * the URL hash (implicit).
 */
function AuthCallback() {
  const colors = useThemeColors();
  const router = useRouter();
  const searchParams = useSearchParams();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const code = searchParams.get('code');
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          throw new Error('This link is missing its verification token.');
        }

        await restoreSession(true);
        if (!cancelled) router.replace('/dashboard');
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : 'This verification link is invalid or has expired.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount — the token in the URL doesn't change under us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!error) return <LoadingState />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center" style={{ backgroundColor: colors.bg }}>
      <h1 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        Verification failed
      </h1>
      <p className="max-w-sm text-sm" style={{ color: colors.inkMuted }}>
        {error}
      </p>
      <Button label="Back to Login" onClick={() => router.replace('/login')} />
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AuthCallback />
    </Suspense>
  );
}
