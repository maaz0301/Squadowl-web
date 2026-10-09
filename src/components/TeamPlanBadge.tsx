'use client';

import { Badge } from '@/components/ui';
import { effectiveTierForTeam, getPlanDefinition } from '@/data/plans';
import type { Team } from '@/data/types';
import { useUser } from '@/state/authStore';

/**
 * The access a manager has on a delegated team, shown next to its name: Coach
 * access (or their own plan, if higher). The owning club's plan stays with the club.
 */
export function TeamPlanBadge({ team }: { team: Pick<Team, 'managed' | 'ownerPlanTier'> }) {
  const user = useUser();
  if (!team.managed) return null;
  const tier = effectiveTierForTeam(team, user?.planTier ?? 'free');
  return <Badge label={`${getPlanDefinition(tier).name} access`} variant="brand" />;
}
