'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAlert } from '@/components/ui';
import type { Tryout } from '@/data/types';
import { useCompleteAssignmentMutation } from '@/features/queries';
import { useIsAssessorOnly } from '@/features/useAssessmentId';
import { usePermissions, useUser } from '@/state/authStore';

/**
 * Complete Assessing — for assessors only, never the owner, a coach/admin or a
 * delegated team manager.
 *
 * `useIsAssessorOnly` alone misses an assessor who is also staff (role
 * 'assessor') on the account that owns the evaluation: `viewerIsOwner` is true
 * for them, so they got no button. The gate is instead "I hold a non-lead
 * assessor row here" plus "I'm not someone who owns or runs it" — a team
 * manager resolves to role 'coach' and has `viewerIsOwner`, so neither half
 * lets them through.
 */
export function useCompleteAssessing(tryout: Pick<Tryout, 'id' | 'assessors' | 'viewerIsOwner'> | null | undefined) {
  const router = useRouter();
  const user = useUser();
  const { role } = usePermissions();
  const { alert, confirm, toast } = useAlert();
  const isAssessorOnly = useIsAssessorOnly(tryout?.viewerIsOwner);
  const completeAssignment = useCompleteAssignmentMutation();
  const [completing, setCompleting] = useState(false);

  const email = user?.email?.toLowerCase();
  const myRow = tryout?.assessors.find(
    (a) => (!!user?.id && a.userId === user.id) || (!!email && a.email?.toLowerCase() === email),
  );
  const canComplete =
    !!tryout &&
    !!myRow &&
    myRow.role !== 'lead' &&
    myRow.status !== 'declined' &&
    myRow.status !== 'completed' &&
    (isAssessorOnly || role === 'assessor');

  /** `beforeComplete` flushes a screen's unsaved scores; a throw there aborts. */
  const complete = async (beforeComplete?: () => Promise<void>) => {
    if (!tryout) return;
    const ok = await confirm({
      title: 'Complete assessing?',
      message:
        'This evaluation will be removed from your screen. Your scores are saved and stay with the coach.',
      confirmLabel: 'Complete',
    });
    if (!ok) return;
    setCompleting(true);
    try {
      await beforeComplete?.();
      await completeAssignment.mutateAsync(tryout.id);
      toast('Assessing complete', 'success');
      router.push('/dashboard');
    } catch (err) {
      await alert('Error', err instanceof Error ? err.message : 'Could not complete this evaluation.');
    } finally {
      setCompleting(false);
    }
  };

  return { canComplete, completing, complete };
}
