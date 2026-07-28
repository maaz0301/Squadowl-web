'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/state/authStore';
import { useMounted } from '@/lib/hooks';
import { LoadingState } from '@/components/ui';

/**
 * Web equivalent of RootNavigator's session branch: unauthenticated users go to
 * /login, and a signed-in user whose email is still unverified is held on
 * /verify-email until they confirm.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const session = useAuthStore((s) => s.session);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const router = useRouter();
  const pathname = usePathname();

  const ready = mounted && isHydrated;
  const unverified = !!session?.user && session.user.emailVerified === false;

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (unverified && pathname !== '/verify-email') {
      router.replace('/verify-email');
    }
  }, [ready, session, unverified, pathname, router]);

  if (!ready || !session || (unverified && pathname !== '/verify-email')) {
    return <LoadingState message="Loading..." />;
  }

  return <>{children}</>;
}

/** Inverse of AuthGate for /login, /signup and friends. */
export function GuestGate({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const session = useAuthStore((s) => s.session);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const router = useRouter();

  const ready = mounted && isHydrated;
  const signedIn = !!session && session.user.emailVerified !== false;

  useEffect(() => {
    if (ready && signedIn) router.replace('/dashboard');
  }, [ready, signedIn, router]);

  if (!ready || signedIn) return <LoadingState message="Loading..." />;

  return <>{children}</>;
}
