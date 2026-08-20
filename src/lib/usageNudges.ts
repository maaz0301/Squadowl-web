import {
  getPlanDefinition,
  getNextUsefulTier,
  getTeamAllowance,
  sellsExtraTeams,
  formatLimit,
  formatCad,
  type UsageLimitMetric,
} from '@/data/plans';
import type { PlanTier } from '@/data/types';

export const NUDGE_THRESHOLD = 0.85;

export type UsageMetric = UsageLimitMetric;

/** The limit in force for this metric — for teams that's the plan's included teams plus
 * any add-on team licenses the account has bought, not the bare plan number. */
export function effectiveLimit(
  tier: PlanTier,
  metric: UsageMetric,
  extraTeamLicenses = 0
): number | 'unlimited' {
  if (metric === 'teams') return getTeamAllowance(tier, extraTeamLicenses);
  return getPlanDefinition(tier).limits[metric];
}

/** Builds the "You're at X of Y ..." copy shown by the in-app usage-nudge banner. */
export function buildNudgeMessage(
  tier: PlanTier,
  metric: UsageMetric,
  count: number,
  label: string,
  extraTeamLicenses = 0
): string {
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  const next = getNextUsefulTier(tier, metric);
  if (metric === 'teams' && sellsExtraTeams(tier)) {
    return `You're at ${count} of ${formatLimit(limit)} teams — add more for ${formatCad(
      getPlanDefinition(tier).extraTeamPriceCents!
    )} per team per year.`;
  }
  return next
    ? `You're at ${count} of ${formatLimit(limit)} ${label} — upgrade to ${next.name} for ${formatLimit(next.limits[metric])} ${label}.`
    : `You're at ${count} of ${formatLimit(limit)} ${label}.`;
}

/** Builds the hard-block "you can't create another one" copy for LimitReachedModal —
 * unlike buildNudgeMessage this always names the tier that actually raises the limit
 * (getNextUsefulTier), since the immediate next tier sometimes doesn't (Free and Coach
 * both cap teams at 1). On a tier that sells extra teams there is no tier to name: the
 * fix is buying another team license, so the copy points at that instead. */
export function buildLimitReachedMessage(
  tier: PlanTier,
  metric: UsageMetric,
  label: string,
  extraTeamLicenses = 0
): string {
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  if (metric === 'teams' && sellsExtraTeams(tier)) {
    return `You're using all ${formatLimit(limit)} of your teams. Add another team for ${formatCad(
      getPlanDefinition(tier).extraTeamPriceCents!
    )} per year from the plans screen.`;
  }
  const next = getNextUsefulTier(tier, metric);
  return next
    ? `You've reached your plan's limit of ${formatLimit(limit)} ${label}. Upgrade to ${next.name} for ${formatLimit(next.limits[metric])} ${label}.`
    : `You've reached your plan's limit of ${formatLimit(limit)} ${label}.`;
}
