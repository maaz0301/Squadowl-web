'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDataSource } from '@/data';
import { logImpersonation } from '@/data/founder/founderApi';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/state/authStore';
import { useImpersonationStore } from '@/state/impersonationStore';

/**
 * Enter and leave the founder's read-only "view as organization". Both
 * directions throw away every cached query and re-read the profile, since
 * everything on screen was loaded for the other account.
 */
export function useImpersonation() {
  const router = useRouter();
  const target = useImpersonationStore((s) => s.target);
  const [pending, setPending] = useState(false);

  const reload = async (href: string) => {
    getDataSource().resetAccountContext();
    queryClient.clear();
    await useAuthStore.getState().refreshProfile();
    router.push(href);
  };

  return {
    target,
    pending,
    start: async (accountId: string, accountName: string) => {
      setPending(true);
      try {
        await logImpersonation(accountId, true);
        useImpersonationStore.getState().setTarget({ accountId, accountName, startedAt: Date.now() });
        await reload('/dashboard');
      } finally {
        setPending(false);
      }
    },
    exit: async () => {
      const current = useImpersonationStore.getState().target;
      setPending(true);
      try {
        useImpersonationStore.getState().setTarget(null);
        // Leaving must always work, even if the log write doesn't.
        if (current) {
          await logImpersonation(current.accountId, false).catch((e) =>
            console.warn('Could not log end of view-as:', e instanceof Error ? e.message : e),
          );
        }
        await reload(current ? `/founder/organizations/${current.accountId}` : '/founder');
      } finally {
        setPending(false);
      }
    },
  };
}
