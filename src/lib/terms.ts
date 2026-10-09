import { useUser } from '@/state/authStore';
import type { CustomLabels } from '@/data/types';
import { cleanLabel, makeT, resolveTerms, type TermsWithT } from '@/lib/termsCore';

export * from '@/lib/termsCore';

/**
 * Terms for the current screen. An evaluation's own names (its Settings) win
 * over any account-level names, which win over the standard ones. Screens that
 * aren't inside an evaluation call this with no argument.
 */
export function useTerms(evaluationLabels?: CustomLabels | null, sport?: string | null): TermsWithT {
  const account = useUser()?.customLabels;
  const merged: CustomLabels = { ...account };
  for (const key of ['player', 'jersey', 'sport'] as const) {
    const v = cleanLabel(evaluationLabels?.[key]);
    if (v) merged[key] = v;
  }
  const resolved = resolveTerms(merged, sport);
  return { ...resolved, t: makeT(resolved) };
}
