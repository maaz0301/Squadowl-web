'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, LoadingState } from '@/components/ui';

const OTP_TYPES: ReadonlySet<string> = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

/**
 * Only a path on this same app is safe to hand to the router — anything else
 * arriving in `?next=` is someone else's URL (or the mobile app's
 * `aastryout://` scheme, which a browser can't open at all).
 */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

/**
 * Where signup/invite confirmation links land. The app turns off
 * detectSessionInUrl (see lib/supabase.ts) so the OTP-based password-reset
 * flow doesn't fight over the URL, which means nothing else auto-consumes a
 * confirmation link's token either — without this page that link would just
 * drop the browser on a blank tab.
 *
 * Handles every link shape that can reach it:
 *  - `token_hash` + `type` in the query, which this page verifies itself.
 *    This is what auth-send-email now sends, and it is the only shape that
 *    doesn't route the browser through Supabase's `/auth/v1/verify` redirect
 *    first (see the comment on buildConfirmUrl for the two ways that hop
 *    stranded people — a dead `aastryout://` deep link on iOS, and a silent
 *    fallback to the site root that drops the token).
 *  - `code` in the query (PKCE) and `access_token`/`refresh_token` in the
 *    hash (implicit), the shapes older links and that redirect still produce.
 *  - `error` / `error_description`, which the same redirect puts in the hash
 *    for an expired or already-used link — worth showing verbatim instead of
 *    claiming the token is missing.
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
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const param = (key: string) => searchParams.get(key) ?? hash.get(key);

        const errorCode = param('error_code') ?? param('error');
        if (errorCode) {
          const description = param('error_description')?.replace(/\+/g, ' ');
          throw new Error(
            description ||
              (errorCode === 'otp_expired'
                ? 'This verification link has expired. Request a new one and try again.'
                : 'This verification link is invalid or has already been used.'),
          );
        }

        const tokenHash = param('token_hash');
        const type = param('type');
        const code = param('code');
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');

        if (tokenHash && type && OTP_TYPES.has(type)) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          if (otpError) throw otpError;
        } else if (code) {
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
        if (!cancelled) router.replace(safeNext(searchParams.get('next')) ?? '/dashboard');
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
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center"
      style={{
        backgroundColor: colors.bg,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
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
