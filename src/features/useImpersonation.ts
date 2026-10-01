'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDataSource } from '@/data';
import { getOrganizationPeople, logImpersonation } from '@/data/founder/founderApi';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/state/authStore';
import { useImpersonationStore, type ImpersonationTarget } from '@/state/impersonationStore';

/**
 * Enter and leave the founder's read-only "view as" — a whole organization (as
 * its admin), or one user (as that person: their role, managed teams, assessor
 * assignments and guardian athletes). Both
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
    /**
     * `accountId` is the organization the view is opened from; the audit log
     * records it (founder_log_impersonation only takes an account). Pass `user`
     * to view as that one person rather than as the organization's admin.
     */
    start: async (accountId: string, accountName: string, user?: ImpersonationTarget['user']) => {
      setPending(true);
      try {
        // Org view reads the owner's managed teams and assessor assignments too.
        // Best-effort: without an owner it still shows the account's own data.
        const people = user
          ? undefined
          : await getOrganizationPeople(accountId).catch((e) => {
              console.warn('Could not look up the organization members:', e instanceof Error ? e.message : e);
              return undefined;
            });
        await logImpersonation(accountId, true);
        useImpersonationStore.getState().setTarget({
          accountId,
          accountName,
          startedAt: Date.now(),
          founderId: useAuthStore.getState().session?.user?.id,
          user,
          owner: people?.owner,
          memberIds: people?.memberIds,
        });
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
