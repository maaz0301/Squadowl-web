'use client';

import { useTerms } from '@/lib/terms';
import { EmptyState } from '@/components/ui';

/**
 * Shown in place of a screen an invited assessor may reach but not use.
 *
 * Assessors score players and edit the roster; results, settings, rubrics,
 * registrations and exports belong to the coach who created the assessment.
 * The tab strip hides those screens for them (see the assessment layout), so
 * this only appears when someone arrives by URL — which is exactly how the
 * `?assessor=1` tab-hiding was got around before `viewerIsOwner` existed.
 */
export function CoachOnlyState({ what, labels }: { what: string; labels?: import('@/data/types').CustomLabels }) {
  const terms = useTerms(labels);
  return (
    <EmptyState
      title="Coach only"
      message={terms.t(`Only the coach who created this evaluation can ${what}. You can still score players and edit the roster.`)}
    />
  );
}
