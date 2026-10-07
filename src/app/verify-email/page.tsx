'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, LoadingState, ThemeToggle, useAlert } from '@/components/ui';
import { useMounted } from '@/lib/hooks';

export default function VerifyEmailPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const mounted = useMounted();
  const { alert } = useAlert();
  const user = useUser();
  const session = useAuthStore((s) => s.session);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const resendVerificationEmail = useAuthStore((s) => s.resendVerificationEmail);
  const logout = useAuthStore((s) => s.logout);

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const ready = mounted && isHydrated;

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace('/login');
    else if (session.user.emailVerified !== false) router.replace('/dashboard');
  }, [ready, session, router]);

  const handleCheckStatus = async () => {
    setChecking(true);
    setStatusMsg(null);
    try {
      await restoreSession(true);
      const currentUser = useAuthStore.getState().session?.user;
      if (currentUser?.emailVerified) {
        await alert('Verified!', 'Your email has been verified. Welcome to SquadOwl!');
        router.replace('/dashboard');
      } else {
        setStatusMsg('Email is not verified yet. Please check your inbox and tap the link.');
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Could not verify status.');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (!user?.email) return;
    setResending(true);
    setStatusMsg(null);
    try {
      await resendVerificationEmail(user.email);
      await alert('Email Sent', `A new verification email was sent to ${user.email}.`);
    } catch (e) {
      await alert('Resend Failed', e instanceof Error ? e.message : 'Failed to resend verification email.');
    } finally {
      setResending(false);
    }
  };

  if (!ready || !session) return <LoadingState />;

  return (
    <div
      className="flex min-h-dvh items-center justify-center px-4"
      style={{
        backgroundColor: colors.bg,
        paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-[520px]">
        <h1
          className="text-2xl font-bold"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          Verify your email address
        </h1>
        <p className="mt-2 text-[15px]" style={{ color: colors.inkMuted }}>
          We need to confirm you own this email address before granting full access to your account.
        </p>

        <Card accent className="mt-5 flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Target Email
          </span>
          <span className="text-lg font-bold" style={{ color: colors.primary }}>
            {user?.email ?? 'Your registered email'}
          </span>
        </Card>

        {statusMsg ? (
          <p className="mt-4 text-center text-sm" style={{ color: colors.warning }}>
            {statusMsg}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-3">
          <Button label="I've Verified — Continue to App" onClick={handleCheckStatus} loading={checking} fullWidth size="lg" />
          <Button label="Resend Verification Email" variant="secondary" onClick={handleResend} loading={resending} fullWidth />
          <Button
            label="Sign Out / Back to Login"
            variant="ghost"
            fullWidth
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await logout();
                router.replace('/login');
              } finally {
                setSigningOut(false);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
