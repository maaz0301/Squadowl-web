import type { PlanTier, Team } from './types';

export interface PlanFeature {
  label: string;
  included: boolean;
  /** Included identically on every tier (e.g. Team Chat Messenger) — always rendered in the "all plans" accent. */
  allPlans?: boolean;
  /** A cost/fee line rather than a capability (e.g. Stripe payments + platform fee) — rendered in the fee accent. */
  fee?: boolean;
  /** Indented detail lines shown under this feature, e.g. the Stripe fee breakdown under "Stripe payments". */
  subItems?: string[];
}

export type BillingInterval = 'year' | 'month';

export interface PlanPricing {
  year: { amountCents: number };
  month: { amountCents: number };
}

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  /** Short one-line description shown under the plan name, e.g. "For individual coaches". */
  tagline: string;
  highlight?: boolean;
  /** null for the Free tier, which has no Stripe pricing at all. */
  pricing: PlanPricing | null;
  /**
   * Per-year price of one team beyond `limits.teams`, for tiers that sell extra
   * teams as an add-on (Club: CAD$10/team beyond the 6 included). Undefined means
   * the tier has a hard team cap you can only raise by changing plans.
   */
  extraTeamPriceCents?: number;
  features: PlanFeature[];
  limits: {
    assessments: number | 'unlimited';
    players: number | 'unlimited';
    teams: number | 'unlimited';
    customRubrics: number | 'unlimited';
    teamBuilder: boolean;
    aiSummaries: boolean;
    exports: ('csv' | 'pdf' | 'xlsx')[];
    shareLinks: boolean;
    seasonHub: boolean;
    guardianPortal: boolean;
    enterprise: boolean;
    /** Delegate a team to another coach/manager by email (Coach+ and up). */
    teamManagers: boolean;
    qrRegistration: boolean;
    /** Stripe payment collection (+ 0.5% TryoutHQ platform fee) for this tier. */
    payments: boolean;
  };
}

/** Stripe's own cut, shown as a sub-item under "Stripe payments" on every paid tier. */
const STRIPE_FEE_SUBITEMS = ['0.5% of registration fees collected', 'Stripe: 2.9% ', 'CAD$0.30 per transaction'];

/** Per-year price of one additional Club team beyond the 6 included in the plan. */
export const EXTRA_TEAM_PRICE_CENTS = 1000;

/** Teams included in the Club plan before add-on team licenses are purchased. */
const CLUB_INCLUDED_TEAMS = 6;

// Tiers, pricing, and feature copy mirror the mobile app's src/data/plans.ts exactly — the
// two are meant to render identical plan cards. Keep them in sync when either changes.
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: 'free',
    name: 'Free',
    tagline: 'Try it out — no credit card needed',
    pricing: null,
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: '1 team', included: true },
      { label: '1 evaluation', included: true },
      { label: '15 players', included: true },
      { label: 'QR registration', included: true },
      { label: 'Basic scoring', included: true },
      { label: 'Historical player profiles', included: true },
      { label: 'Stripe payments', included: false, fee: true },
      { label: 'AI summaries', included: false },
      { label: 'PDF exports', included: false },
      { label: 'Dashboard', included: false },
    ],
    limits: {
      assessments: 1,
      players: 15,
      teams: 1,
      customRubrics: 3,
      teamBuilder: false,
      aiSummaries: false,
      exports: [],
      shareLinks: false,
      seasonHub: false,
      guardianPortal: false,
      enterprise: false,
      teamManagers: false,
      qrRegistration: true,
      payments: false,
    },
  },
  {
    tier: 'coach',
    name: 'Coach',
    tagline: 'For individual coaches',
    pricing: { year: { amountCents: 3999 }, month: { amountCents: 400 } },
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: 'Stripe payments', included: true, fee: true, subItems: STRIPE_FEE_SUBITEMS },
      { label: '1 team', included: true },
      { label: 'Unlimited evaluations', included: true },
      { label: '30 players', included: true },
      { label: 'QR registration & cloud sync', included: true },
      { label: 'CSV export', included: true },
      { label: 'Season Hub (basic)', included: true },
      { label: 'Historical player profiles', included: true },
      { label: 'Basic payment dashboard', included: true },
      { label: 'Guardian portal (basic)', included: true },
      { label: 'AI summaries', included: false },
      { label: 'PDF exports', included: false },
    ],
    limits: {
      assessments: 'unlimited',
      players: 30,
      teams: 1,
      customRubrics: 5,
      teamBuilder: false,
      aiSummaries: false,
      exports: ['csv'],
      shareLinks: false,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      teamManagers: false,
      qrRegistration: true,
      payments: true,
    },
  },
  {
    tier: 'coach_plus',
    name: 'Coach+',
    tagline: 'For serious coaches & rep teams',
    highlight: true,
    pricing: { year: { amountCents: 6999 }, month: { amountCents: 700 } },
    extraTeamPriceCents: EXTRA_TEAM_PRICE_CENTS,
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: 'Stripe payments', included: true, fee: true, subItems: STRIPE_FEE_SUBITEMS },
      { label: '2 teams included', included: true },
      {
        label: `${formatCad(EXTRA_TEAM_PRICE_CENTS)} per additional team beyond 2`,
        included: true,
        fee: true,
      },
      { label: 'Unlimited evaluations', included: true },
      { label: '100 players', included: true },
      { label: 'Everything in Coach', included: true },
      { label: 'Full dashboard', included: true },
      { label: 'Per player fee breakdown', included: true },
      { label: 'Historical player profiles', included: true },
      { label: 'AI player summaries', included: true },
      { label: 'AI Team Builder', included: true },
      { label: 'PDF export & share links', included: true },
      { label: 'Guardian portal emails', included: true },
      { label: 'Player comparisons', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 100,
      teams: 2,
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      teamManagers: true,
      qrRegistration: true,
      payments: true,
    },
  },
  {
    tier: 'club',
    name: 'Club',
    tagline: 'For clubs & organizations of any size',
    pricing: { year: { amountCents: 9999 }, month: { amountCents: 1000 } },
    extraTeamPriceCents: EXTRA_TEAM_PRICE_CENTS,
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: 'Stripe payments', included: true, fee: true, subItems: STRIPE_FEE_SUBITEMS },
      { label: `${CLUB_INCLUDED_TEAMS} teams included`, included: true },
      {
        label: `${formatCad(EXTRA_TEAM_PRICE_CENTS)} per additional team beyond ${CLUB_INCLUDED_TEAMS}`,
        included: true,
        fee: true,
      },
      { label: 'Unlimited evaluations', included: true },
      { label: 'Unlimited players', included: true },
      { label: 'Everything in Coach+', included: true },
      { label: 'Full dashboard', included: true },
      { label: 'Full association dashboard', included: true },
      { label: 'Registration intake management', included: true },
      { label: 'Age group reporting', included: true },
      { label: 'Friend / teammate requests', included: true },
      { label: 'License purchasing', included: true },
      { label: 'Multi-staff roles & access', included: true },
      { label: 'White-label PDF exports', included: true },
      { label: 'Bulk CSV import', included: true },
      { label: 'Priority support', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 'unlimited',
      teams: CLUB_INCLUDED_TEAMS,
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf', 'xlsx'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: true,
      teamManagers: true,
      qrRegistration: true,
      payments: true,
    },
  },
];

export function getPlanDefinition(tier: PlanTier): PlanDefinition {
  // Falls back to Free, not some arbitrary array index — the DB's plan_tier
  // enum still allows legacy values ('pro', 'association') that predate this
  // 4-tier model and have no PLAN_DEFINITIONS entry. Defaulting an
  // unrecognized tier to Coach would silently grant Coach-level features
  // (canUseFeature reads off this same lookup) to whatever that value turns
  // out to mean instead of just failing safe.
  return PLAN_DEFINITIONS.find((p) => p.tier === tier) ?? PLAN_DEFINITIONS[0];
}

export function canUseFeature(tier: PlanTier, feature: keyof PlanDefinition['limits']): boolean {
  const plan = getPlanDefinition(tier);
  const val = plan.limits[feature];
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.length > 0;
  if (val === 'unlimited') return true;
  return (val as number) > 0;
}

export function isAtAssessmentLimit(tier: PlanTier, count: number): boolean {
  const limit = getPlanDefinition(tier).limits.assessments;
  if (limit === 'unlimited') return false;
  return count >= limit;
}

export function isAtPlayerLimit(tier: PlanTier, count: number): boolean {
  const limit = getPlanDefinition(tier).limits.players;
  if (limit === 'unlimited') return false;
  return count >= limit;
}

/**
 * How many teams the account may have, once purchased add-on team licenses are
 * counted in. Licenses only widen the cap on tiers that actually sell them
 * (`extraTeamPriceCents`), so a license count left over on an account that has
 * since downgraded can't silently raise a Free/Coach/Coach+ cap.
 */
export function getTeamAllowance(tier: PlanTier, extraTeamLicenses = 0): number | 'unlimited' {
  const plan = getPlanDefinition(tier);
  const limit = plan.limits.teams;
  if (limit === 'unlimited') return 'unlimited';
  if (!plan.extraTeamPriceCents) return limit;
  return limit + Math.max(0, extraTeamLicenses);
}

/** Whether the tier sells extra teams as an add-on rather than hard-capping them. */
export function sellsExtraTeams(tier: PlanTier): boolean {
  return !!getPlanDefinition(tier).extraTeamPriceCents;
}

export function isAtTeamLimit(tier: PlanTier, count: number, extraTeamLicenses = 0): boolean {
  const limit = getTeamAllowance(tier, extraTeamLicenses);
  if (limit === 'unlimited') return false;
  return count >= limit;
}

/**
 * The dummy-data testing tools are offered on every plan, and only the founder
 * can switch them off — for all plans or for individual ones — from the founder
 * console (`platform_settings.dummy_data_blocked_plan_tiers`). Callers pass the
 * tiers the platform reports as blocked; nothing reported, including the setting
 * being unreachable, means available. Whatever is on, generation still stops at
 * the plan's own limits (see the *Room helpers below).
 */
export function canUseDummyData(tier: PlanTier, blockedTiers: readonly PlanTier[] = []): boolean {
  return !blockedTiers.includes(tier);
}

function roomUnder(limit: number | 'unlimited', used: number): number {
  return limit === 'unlimited' ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
}

/** How many more players one roster (an evaluation's, or a team's) can take on this plan. */
export function playerRoom(tier: PlanTier, currentPlayers: number): number {
  return roomUnder(getPlanDefinition(tier).limits.players, currentPlayers);
}

/** How many more evaluations this plan allows. */
export function assessmentRoom(tier: PlanTier, currentAssessments: number): number {
  return roomUnder(getPlanDefinition(tier).limits.assessments, currentAssessments);
}

/** How many more teams this plan allows, counting purchased team licenses. */
export function teamRoom(tier: PlanTier, currentTeams: number, extraTeamLicenses = 0): number {
  return roomUnder(getTeamAllowance(tier, extraTeamLicenses), currentTeams);
}

export function formatLimit(limit: number | 'unlimited'): string {
  return limit === 'unlimited' ? 'Unlimited' : String(limit);
}

const TIER_ORDER: PlanTier[] = PLAN_DEFINITIONS.map((p) => p.tier);

/** Whether `tier` is at or above `min` in the plan hierarchy (free < coach < coach_plus < club). */
export function isTierAtLeast(tier: PlanTier, min: PlanTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

/**
 * Position of `tier` in the free < coach < coach_plus < club hierarchy, for
 * telling an upgrade from a downgrade.
 *
 * A tier with no PLAN_DEFINITIONS entry ranks as Free, matching
 * getPlanDefinition()'s fail-safe: the DB enum still carries the retired
 * 'pro'/'association' values, and ranking an unknown one high would present a
 * genuine upgrade as a downgrade and route it through the cancellation flow.
 */
export function getTierRank(tier: PlanTier): number {
  const idx = TIER_ORDER.indexOf(tier);
  return idx === -1 ? 0 : idx;
}

/**
 * The plan tier that should gate a team-scoped feature (exports, AI summaries,
 * Team Builder, custom rubrics, fee collection). Normally the caller's own
 * account tier — but when `team` is one delegated to them (CLUB mode), the
 * owning club's tier instead: the club already pays for the team, so the
 * coach it was handed to shouldn't hit an upgrade wall managing it.
 *
 * Falls back to `ownTier` whenever the team isn't managed, or the delegated
 * team's owner tier hasn't loaded yet — never grants more than the caller
 * actually has by default.
 */
export function effectiveTierForTeam(
  team: Pick<Team, 'managed' | 'ownerPlanTier'> | null | undefined,
  ownTier: PlanTier,
): PlanTier {
  if (team?.managed && team.ownerPlanTier) return team.ownerPlanTier;
  return ownTier;
}

/** The next tier up from `tier`, or null if already on the top tier. */
export function getNextTier(tier: PlanTier): PlanDefinition | null {
  const idx = PLAN_DEFINITIONS.findIndex((p) => p.tier === tier);
  if (idx === -1 || idx === PLAN_DEFINITIONS.length - 1) return null;
  return PLAN_DEFINITIONS[idx + 1];
}

/** Fraction (0-1) of a numeric/unlimited limit that `count` represents. 0 for unlimited limits. */
export function usageFraction(limit: number | 'unlimited', count: number): number {
  if (limit === 'unlimited' || limit <= 0) return 0;
  return count / limit;
}

export type UsageLimitMetric = 'assessments' | 'players' | 'teams' | 'customRubrics';

/** The next tier up whose limit for `metric` actually improves on `tier`'s — skips tiers
 * where the limit is unchanged (e.g. Free and Coach both cap teams at 1, so a Free user
 * hitting the team limit should be pointed at Coach+, not Coach). Null if no higher tier
 * raises this particular limit. */
export function getNextUsefulTier(tier: PlanTier, metric: UsageLimitMetric): PlanDefinition | null {
  const startIdx = TIER_ORDER.indexOf(tier);
  if (startIdx === -1) return null;
  const currentLimit = getPlanDefinition(tier).limits[metric];
  for (let idx = startIdx + 1; idx < PLAN_DEFINITIONS.length; idx++) {
    const candidateLimit = PLAN_DEFINITIONS[idx].limits[metric];
    if (candidateLimit === 'unlimited' && currentLimit !== 'unlimited') return PLAN_DEFINITIONS[idx];
    if (typeof candidateLimit === 'number' && typeof currentLimit === 'number' && candidateLimit > currentLimit) {
      return PLAN_DEFINITIONS[idx];
    }
  }
  return null;
}

/** "CAD$39.99" / "CAD$10" — whole dollar amounts drop the cents. */
export function formatCad(cents: number): string {
  const dollars = cents / 100;
  return `CAD$${Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

/** Formats a plan's price for a given billing interval, e.g. "CAD$39.99" / "/yr". */
export function formatPlanPrice(
  plan: PlanDefinition,
  interval: BillingInterval,
): { price: string; priceNote: string } {
  if (!plan.pricing) return { price: 'CAD$0', priceNote: 'forever' };
  return {
    price: formatCad(plan.pricing[interval].amountCents),
    priceNote: interval === 'year' ? '/yr' : '/month',
  };
}
