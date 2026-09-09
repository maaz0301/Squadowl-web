import {
  formatCad,
  formatLimit,
  getPlanDefinition,
  getTierRank,
  sellsExtraTeams,
  type PlanDefinition,
} from '@/data/plans';
import type { PlanTier } from '@/data/types';

export type PlanChangeDirection = 'upgrade' | 'downgrade' | 'current';

/** Which way a switch from `from` to `to` moves in the free < coach < coach_plus < club hierarchy. */
export function planChangeDirection(from: PlanTier, to: PlanTier): PlanChangeDirection {
  if (from === to) return 'current';
  return getTierRank(to) > getTierRank(from) ? 'upgrade' : 'downgrade';
}

/**
 * How a plan change is carried out.
 *
 * `portal` — the Stripe Customer Portal, which is the only safe route while a
 * subscription is live: the plan swap has to replace the existing subscription
 * (with whatever proration Stripe is configured for), and starting a second
 * Checkout would leave the account paying for two. Cancelling down to Free is
 * the same story.
 *
 * `checkout` — an ordinary Checkout for the target tier, used when there is no
 * live subscription to replace (a lapsed or cancelled account whose profile
 * still carries the old tier). There is nothing for the portal to manage there.
 */
export type PlanChangeRoute = 'portal' | 'checkout';

/** Whether a Stripe subscription is live enough that plan changes must go through the portal. */
export function hasLiveSubscription(subscriptionStatus: string | undefined): boolean {
  return subscriptionStatus === 'active' || subscriptionStatus === 'trialing';
}

/**
 * The route for a switch *down* to `target` — a lower tier, or Free.
 *
 * Upgrades deliberately do not consult this. They always go through Checkout,
 * because they are billed in full for a fresh year rather than prorated, and
 * the portal's switch flow can only ever charge the prorated difference. The
 * superseded subscription is cancelled by stripe-webhook once that checkout
 * completes, which is what keeps "Checkout always creates a new subscription"
 * from meaning "the account now pays for two".
 *
 * A downgrade has no such constraint: it changes nothing today, so the portal
 * (where Stripe schedules it for the end of the paid term) is the right home
 * for it whenever there is a live subscription to schedule against.
 */
export function planChangeRoute(
  target: PlanTier,
  subscriptionStatus: string | undefined,
): PlanChangeRoute {
  // Free has no Stripe price to check out against, so it is only ever reachable
  // by cancelling the existing subscription in the portal.
  if (target === 'free') return 'portal';
  return hasLiveSubscription(subscriptionStatus) ? 'portal' : 'checkout';
}

export interface DowngradeImpactInput {
  from: PlanTier;
  to: PlanTier;
  /** Teams the account has today, for the "you're already over the new cap" lines. */
  teamCount?: number;
  assessmentCount?: number;
  /** Add-on team licenses purchased on the current tier. */
  extraTeamLicenses?: number;
}

/**
 * The capabilities named on the plan cards, in the order they read best in a
 * confirmation dialog. Deliberately not every key in `limits` — `qrRegistration`
 * is on every tier and `enterprise` is covered by the Admin/association wording.
 */
const FEATURE_LABELS: [keyof PlanDefinition['limits'], string][] = [
  ['teamBuilder', 'AI Team Builder'],
  ['aiSummaries', 'AI player summaries'],
  ['shareLinks', 'Share links'],
  ['seasonHub', 'Season Hub'],
  ['guardianPortal', 'Guardian portal'],
  ['teamManagers', 'Delegating teams to other coaches'],
  ['payments', 'Stripe payment collection'],
  ['enterprise', 'Association dashboard & admin portal'],
];

/**
 * One line of a downgrade's impact, grouped by kind so the confirmation UI can
 * render each group with its own heading and tone instead of one run-on
 * paragraph:
 *
 * - `lost` — a capability the lower tier doesn't have at all (AI Team Builder,
 *   an export format, ...). Gone outright.
 * - `limit` — a constraint that now applies: an add-on stops widening a cap,
 *   or the account is already over (or newly capped under) the lower tier's
 *   numeric limit. Worded as "you keep what you have, you just can't add
 *   more" because that is what the app actually does — every limit is
 *   checked at creation time (isAtTeamLimit and friends are called from the
 *   create paths only), so nothing existing is deleted or hidden when the
 *   tier drops.
 */
export interface DowngradeImpactLine {
  kind: 'lost' | 'limit';
  text: string;
}

/**
 * Plain-language consequences of moving down to `to`, for the confirmation the
 * coach sees before they are sent to Stripe.
 *
 * Returns an empty list when the switch costs nothing, which is a real case:
 * Free and Coach both cap teams at 1, so a Coach account with one team and no
 * paid features in use loses nothing measurable by dropping to Free.
 */
export function buildDowngradeImpact(input: DowngradeImpactInput): DowngradeImpactLine[] {
  const { from, to, teamCount, assessmentCount, extraTeamLicenses = 0 } = input;
  const current = getPlanDefinition(from);
  const next = getPlanDefinition(to);
  const lines: DowngradeImpactLine[] = [];

  for (const [key, label] of FEATURE_LABELS) {
    const had = current.limits[key];
    const has = next.limits[key];
    if (had === true && has === false) lines.push({ kind: 'lost', text: label });
  }

  const currentExports = current.limits.exports;
  const nextExports = next.limits.exports;
  const lostExports = currentExports.filter((f) => !nextExports.includes(f));
  if (lostExports.length > 0) {
    const lostLabel = `${lostExports.map((f) => f.toUpperCase()).join(' and ')} export`;
    lines.push({
      kind: 'lost',
      text:
        nextExports.length > 0
          ? `${lostLabel} (${nextExports.map((f) => f.toUpperCase()).join(', ')} stays)`
          : lostLabel,
    });
  }

  // Add-on team licenses only widen the cap on a tier that sells them, so they
  // stop counting the moment the account leaves Club — worth saying out loud,
  // since they were paid for separately and are not refunded by this switch.
  if (extraTeamLicenses > 0 && sellsExtraTeams(from) && !sellsExtraTeams(to)) {
    lines.push({
      kind: 'limit',
      text: `Your ${extraTeamLicenses} purchased team license${extraTeamLicenses === 1 ? '' : 's'} (${formatCad(
        (current.extraTeamPriceCents ?? 0) * extraTeamLicenses,
      )}/yr) stop raising your team cap on ${next.name}.`,
    });
  }

  lines.push(...overLimitLine('teams', 'teams', teamCount, next));
  lines.push(...overLimitLine('assessments', 'evaluations', assessmentCount, next));

  const playerLimit = next.limits.players;
  if (playerLimit !== 'unlimited' && current.limits.players !== playerLimit) {
    lines.push({
      kind: 'limit',
      text: `Players per evaluation are capped at ${formatLimit(playerLimit)} on ${next.name}.`,
    });
  }

  return lines;
}

/**
 * The "you're already over it" line for one numeric limit, or nothing at all
 * when the account is still under the lower tier's cap.
 *
 * Uses the plan's bare limit rather than getTeamAllowance(): purchased licenses
 * are exactly what stops applying on a tier that doesn't sell them, and the
 * separate line above already says so.
 */
function overLimitLine(
  key: 'teams' | 'assessments',
  noun: string,
  count: number | undefined,
  next: PlanDefinition,
): DowngradeImpactLine[] {
  const limit = next.limits[key];
  if (limit === 'unlimited' || count == null) return [];
  if (count <= limit) return [];
  return [
    {
      kind: 'limit',
      text: `You have ${count} ${noun} and ${next.name} includes ${formatLimit(limit)}. Nothing is deleted — you keep them, but you won't be able to create another ${noun.replace(/s$/, '')} until you're back under the limit.`,
    },
  ];
}
