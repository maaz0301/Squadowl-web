'use client';

import type { Tryout } from '@/data/types';
import { getImpersonationTarget } from '@/state/impersonationStore';
import { useUser } from '@/state/authStore';

export type EvaluationAccess = 'loading' | 'allowed' | 'guardian-only';

/**
 * Whether the signed-in user may work inside an evaluation, or can only reach
 * it as the guardian of one of its players.
 *
 * The database lets a guardian read a tryout their athlete is on (the guardian
 * portal depends on it), so the evaluation screens used to open for them too,
 * with the roster, scoring and editing. A guardian belongs in the athlete view
 * only. Anyone who owns or manages the evaluation (`viewerIsOwner`) or holds an
 * assessor row on it keeps full access, and so does a founder viewing as an
 * organization.
 */
export function useEvaluationAccess(
  tryout: Pick<Tryout, 'viewerIsOwner' | 'assessors'> | null | undefined,
): EvaluationAccess {
  const user = useUser();
  if (!tryout || !user) return 'loading';
  if (getImpersonationTarget()) return 'allowed';
  if (tryout.viewerIsOwner) return 'allowed';
  const email = user.email?.toLowerCase();
  const isAssessor = tryout.assessors.some(
    (a) => (!!user.id && a.userId === user.id) || (!!email && a.email?.toLowerCase() === email),
  );
  return isAssessor ? 'allowed' : 'guardian-only';
}
