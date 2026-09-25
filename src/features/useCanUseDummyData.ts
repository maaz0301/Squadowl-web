import { canUseDummyData } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useDummyDataBlockedPlanTiersQuery } from './queries';

/** The plan tiers the founder has switched the dummy-data tools off for; empty until known, so the tools stay on. */
export function useDummyDataBlockedTiers(): readonly PlanTier[] {
  const { data } = useDummyDataBlockedPlanTiersQuery();
  return data ?? [];
}

/** Whether the dummy-data testing tools are on for `tier` — see canUseDummyData(). */
export function useCanUseDummyData(tier: PlanTier): boolean {
  return canUseDummyData(tier, useDummyDataBlockedTiers());
}
