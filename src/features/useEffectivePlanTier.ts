import { useTeamsQuery } from '@/features/queries';
import { effectiveTierForTeam } from '@/data/plans';
import { useUser } from '@/state/authStore';
import type { PlanTier } from '@/data/types';

/**
 * The plan tier a team-scoped (or tryout-scoped, via its linked team) screen
 * should gate features against. See effectiveTierForTeam: normally the
 * caller's own tier, but a delegated (CLUB mode) team's features gate against
 * the owning club's tier instead, so a coach managing a paying club's team
 * doesn't hit an upgrade wall for a plan that isn't theirs to begin with.
 *
 * Safe to call with `teamId` undefined (an unlinked tryout, or before the
 * tryout has loaded) — it just returns the caller's own tier.
 */
export function useEffectivePlanTier(teamId: string | null | undefined): PlanTier {
  const user = useUser();
  const teamsQuery = useTeamsQuery();
  const ownTier = user?.planTier ?? 'free';
  const team = teamId ? teamsQuery.data?.find((t) => t.id === teamId) : undefined;
  return effectiveTierForTeam(team, ownTier);
}
