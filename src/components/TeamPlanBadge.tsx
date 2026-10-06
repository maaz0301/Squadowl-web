'use client';

import { Badge } from '@/components/ui';
import { effectiveTierForTeam, getPlanDefinition } from '@/data/plans';
import type { Team } from '@/data/types';
import { useUser } from '@/state/authStore';

/**
 * The plan level a delegated team runs at, shown next to its name. It is the
 * team owner's plan, so every manager of the team sees the same level; upgrading
 * it is up to the owner's account.
 */
export function TeamPlanBadge({ team }: { team: Pick<Team, 'managed' | 'ownerPlanTier'> }) {
  const user = useUser();
  if (!team.managed || !team.ownerPlanTier) return null;
  const tier = effectiveTierForTeam(team, user?.planTier ?? 'free');
  return <Badge label={`${getPlanDefinition(tier).name} level`} variant="brand" />;
}
