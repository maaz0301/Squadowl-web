'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Input, PageHeader, Switch, useAlert } from '@/components/ui';
import {
  PLAN_DEFINITIONS,
  formatCad,
  formatPlanPrice,
  getPlanDefinition,
  getTeamAllowance,
  getTierRank,
  sellsExtraTeams,
} from '@/data/plans';
import type { PlanTier } from '@/data/types';
import {
  buildDowngradeImpact,
  hasLiveSubscription,
  planChangeDirection,
  planChangeRoute,
} from '@/lib/planChange';
import { useUser } from '@/state/authStore';
import { getDataSource } from '@/data';
import {
  useApplyReferralCodeMutation,
  useAssessmentCountQuery,
  useReferralSummaryQuery,
  useTeamCountQuery,
} from '@/features/queries';

function formatPlanDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function UpgradePage() {
  const colors = useThemeColors();
  const user = useUser();
  const { alert, confirm } = useAlert();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [extraTeams, setExtraTeams] = useState(1);
  const [buyingTeams, setBuyingTeams] = useState(false);
  // Monthly billing is temporarily hidden — every checkout goes through yearly for now,
  // matching the mobile app.
  const billingInterval = 'year' as const;

  // Usage behind the downgrade warning: what the account has today, measured
  // against the lower plan's caps. Both are the cheap count-only reads, and
  // both are already cached by the screens that create teams and evaluations.
  const teamCountQuery = useTeamCountQuery();
  const assessmentCountQuery = useAssessmentCountQuery();

  // Loyalty program: spend existing credit, and enter someone else's code.
  const referralQuery = useReferralSummaryQuery();
  const applyCodeMut = useApplyReferralCodeMutation();
  const [referralCode, setReferralCode] = useState('');
  const [applyCredits, setApplyCredits] = useState(true);

  const creditCents = referralQuery.data?.balanceCents ?? 0;
  const hasCredit = creditCents > 0;
  // The discount is sized server-side against the real line total; this is
  // only whether to ask for it at all.
  const useCredits = hasCredit && applyCredits;

  const submitReferralCode = async () => {
    const codeValue = referralCode.trim();
    if (!codeValue) return;
    try {
      await applyCodeMut.mutateAsync(codeValue);
      setReferralCode('');
      await alert('Code Applied', 'Thanks! The coach who referred you earns credit once your subscription is paid.');
    } catch (e) {
      // apply_referral_code raises customer-facing wording, so show it as-is.
      await alert('Referral Code', e instanceof Error ? e.message : 'That code could not be applied.');
    }
  };

  const openPortal = async () => {
    try {
      setLoadingPortal(true);
      const res = await getDataSource().createPortalSession();
      if (res?.url) {
        // Same leaving-the-SPA navigation as the checkout below, and the same
        // reason for the exemption — flagged here only now that switchPlan()
        // calls this one too.
        // eslint-disable-next-line react-hooks/immutability
        window.location.href = res.url;
      }
    } catch (err) {
      await alert('Portal Error', err instanceof Error ? err.message : 'Something went wrong opening subscription portal.');
    } finally {
      setLoadingPortal(false);
    }
  };

  const startCheckout = async (tier: PlanTier) => {
    try {
      setLoadingTier(tier);
      const res = await getDataSource().createCheckoutSession(tier, billingInterval, {
        applyCredits: useCredits,
      });
      if (res?.url) {
        // Full-page navigation to Stripe Checkout, not component state — the
        // compiler's immutability check flags any window.location write, but
        // there's no render-safe alternative for leaving the SPA entirely.
        // eslint-disable-next-line react-hooks/immutability
        window.location.href = res.url;
      }
    } catch (err) {
      await alert('Checkout Error', err instanceof Error ? err.message : 'Something went wrong creating checkout session.');
    } finally {
      setLoadingTier(null);
    }
  };

  const currentTier: PlanTier = user?.planTier ?? 'free';
  const currentRank = getTierRank(currentTier);
  const currentLicenses = user?.extraTeamLicenses ?? 0;
  const currentPlan = getPlanDefinition(currentTier);
  const cancelAt = user?.subscriptionCancelAt ? new Date(user.subscriptionCancelAt) : null;
  // A downgrade is scheduled rather than applied, so until the term ends the
  // only evidence of it is this pair of fields.
  const pendingChange =
    user?.pendingPlanTier && user?.pendingPlanChangeAt
      ? { tier: user.pendingPlanTier, at: new Date(user.pendingPlanChangeAt) }
      : null;
  const canBuyTeams = sellsExtraTeams(currentTier);
  const extraTeamPrice = currentPlan.extraTeamPriceCents ?? 0;

  /**
   * Switches to any tier, in either direction. The two directions take
   * deliberately different routes.
   *
   * An **upgrade** always goes through Checkout, and is charged in full for a
   * billing year that restarts today — the remaining time on the plan being
   * left behind is not credited. That is a product decision, not Stripe's
   * default: the portal's own switch flow only ever bills the prorated
   * difference (moving Coach → Coach+ on day one charged CA$30.00, not
   * CA$69.99), and there is no portal setting that charges full price while
   * forfeiting prepaid time. Checkout is the only route that does.
   *
   * The cost of that route is that Checkout always creates a *new*
   * subscription rather than replacing the running one — which is precisely
   * how one account ended up billed for Coach, Coach+, Coach and Club at the
   * same time. stripe-webhook cancels the superseded subscription as soon as
   * this checkout completes; without that half, this is a double-billing bug.
   *
   * A **downgrade** stays with the portal, where it is scheduled rather than
   * applied: the account keeps the tier it has paid for until the term ends.
   * Checkout only picks it up when there is no live subscription for the
   * portal to manage (a lapsed account whose profile still carries the tier).
   */
  const switchPlan = async (tier: PlanTier) => {
    const direction = planChangeDirection(currentTier, tier);
    if (direction === 'current') return;

    if (direction === 'upgrade') {
      const confirmed = await confirmUpgrade(tier);
      if (!confirmed) return;
      await startCheckout(tier);
      return;
    }

    const confirmed = await confirmDowngrade(tier);
    if (!confirmed) return;

    if (planChangeRoute(tier, user?.subscriptionStatus) === 'portal') {
      await openPortal();
      return;
    }
    await startCheckout(tier);
  };

  /**
   * Says out loud what an upgrade costs before sending anyone to Stripe.
   *
   * Only shown when there is a subscription to lose. Charging full price for a
   * fresh year while the current plan's remaining months go uncredited is the
   * kind of thing a customer should agree to in advance rather than discover
   * on the invoice; a first-time subscriber forfeits nothing, so they are sent
   * straight to Checkout without an extra dialog in the way.
   */
  const confirmUpgrade = async (tier: PlanTier) => {
    if (!hasLiveSubscription(user?.subscriptionStatus)) return true;
    const target = getPlanDefinition(tier);
    const price = target.pricing ? formatCad(target.pricing[billingInterval].amountCents) : '';
    return confirm({
      title: `Upgrade to ${target.name}?`,
      message:
        `You'll be charged ${price} today for a full year of ${target.name}, starting now.\n\n` +
        `The time left on your ${currentPlan.name} plan isn't credited or refunded, and that ` +
        `subscription is cancelled once the payment goes through.`,
      confirmLabel: `Continue to payment`,
    });
  };

  /** The "here's what this costs you" gate in front of a downgrade. */
  const confirmDowngrade = async (tier: PlanTier) => {
    const impact = buildDowngradeImpact({
      from: currentTier,
      to: tier,
      teamCount: teamCountQuery.data,
      assessmentCount: assessmentCountQuery.data,
      extraTeamLicenses: currentLicenses,
    });
    const target = getPlanDefinition(tier);
    const ok = await confirm({
      title: `Switch down to ${target.name}?`,
      message: impact.length
        ? `${impact.join('\n\n')}\n\nYou'll finish the change in Stripe, where the new price and any credit for the rest of this term are shown before you confirm.`
        : `${target.name} covers everything you're using today. You'll finish the change in Stripe, where the new price and any credit for the rest of this term are shown before you confirm.`,
      confirmLabel: `Switch to ${target.name}`,
      destructive: true,
    });
    return ok;
  };

  // Extra teams are an add-on subscription on top of the current plan (Club only), so
  // this checkout must not go through `switchPlan` — that one switches the plan tier.
  const buyTeams = async () => {
    try {
      setBuyingTeams(true);
      const res = await getDataSource().createTeamLicenseCheckoutSession(extraTeams, {
        applyCredits: useCredits,
      });
      if (res?.url) window.location.href = res.url;
    } catch (err) {
      await alert('Checkout Error', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBuyingTeams(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Upgrade Plan"
        subtitle={`Current Plan: ${PLAN_DEFINITIONS.find((p) => p.tier === (user?.planTier ?? 'free'))?.name ?? 'Free'}`}
        showBack
        backHref="/profile"
      />

      {/* Loyalty credit — applied to whichever checkout is started below. */}
      {hasCredit ? (
        <Card accent className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              {formatCad(creditCents)} loyalty credit
            </h3>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              {/* Credit is a Checkout coupon, and upgrades go through Checkout
                  again — so it does apply to the switch itself. A downgrade is
                  settled in the portal and never charges anything, so there is
                  nothing for it to discount there either way. */}
              {applyCredits ? 'Will be applied to your next payment below.' : 'Saved for a later payment.'}
            </p>
          </div>
          <Switch checked={applyCredits} onChange={setApplyCredits} />
        </Card>
      ) : null}

      {/* Referral code entry — only meaningful before the first paid plan, and
          only once, so it disappears as soon as one has been attached. */}
      {referralQuery.data && !referralQuery.data.redeemedByCode && !hasLiveSubscription(user?.subscriptionStatus) ? (
        <Card className="mb-6 flex flex-col gap-2">
          <h3 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Have a referral code?
          </h3>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Enter the 9-character code a coach shared with you. They earn credit once your subscription is paid.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="e.g. K7M2QX9BD"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={11}
              className="flex-1"
            />
            <Button
              label="Apply Code"
              variant="secondary"
              onClick={submitReferralCode}
              loading={applyCodeMut.isPending}
              disabled={!referralCode.trim()}
            />
          </div>
        </Card>
      ) : null}

      {canBuyTeams ? (
        <Card className="mb-6 flex flex-col gap-2">
          <h3 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Add Teams
          </h3>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Your plan includes {currentPlan.limits.teams} teams. Additional teams are {formatCad(extraTeamPrice)}{' '}
            each per year.
            {currentLicenses > 0
              ? ` You've purchased ${currentLicenses} so far, for a cap of ${getTeamAllowance(currentTier, currentLicenses)} teams.`
              : ''}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setExtraTeams((n) => Math.max(1, n - 1))}
                className="text-2xl"
                style={{ color: colors.primary }}
                aria-label="Decrease teams"
              >
                −
              </button>
              <span className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                {extraTeams}
              </span>
              <button
                type="button"
                onClick={() => setExtraTeams((n) => Math.min(50, n + 1))}
                className="text-2xl"
                style={{ color: colors.primary }}
                aria-label="Increase teams"
              >
                +
              </button>
            </div>
            <span className="font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
              {formatCad(extraTeamPrice * extraTeams)}/yr
            </span>
          </div>
          <Button
            label={`Add ${extraTeams} team${extraTeams === 1 ? '' : 's'}`}
            onClick={buyTeams}
            loading={buyingTeams}
          />
        </Card>
      ) : null}

      {hasLiveSubscription(user?.subscriptionStatus) ? (
        <Card accent className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-base" style={{ color: colors.ink }}>
              {cancelAt ? 'Subscription Ending' : pendingChange ? 'Plan Change Scheduled' : 'Active Subscription'}
            </h3>
            {/* Both a cancellation and a downgrade are taken at period end, so
                neither changes anything the coach can see on the day they choose
                it — the subscription stays active and the current plan keeps
                working. Saying so is what stops either reading as "it didn't
                work". */}
            {cancelAt ? (
              <p className="text-xs" style={{ color: colors.warning }}>
                Cancelled — your {currentPlan.name} plan stays active until{' '}
                <strong>{formatPlanDate(cancelAt)}</strong>
                , then the account moves to Free. You can restart it any time before then in the portal.
              </p>
            ) : pendingChange ? (
              <p className="text-xs" style={{ color: colors.warning }}>
                Your plan changes from {currentPlan.name} to{' '}
                {getPlanDefinition(pendingChange.tier).name} on{' '}
                <strong>{formatPlanDate(pendingChange.at)}</strong>. You keep {currentPlan.name}{' '}
                until then — nothing changes today.
              </p>
            ) : (
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                Manage billing details, view payment history, or update tier in the Stripe Customer Portal.
              </p>
            )}
          </div>
          <Button
            label="Manage Billing & Invoices"
            variant="secondary"
            onClick={openPortal}
            loading={loadingPortal}
          />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_DEFINITIONS.map((item) => {
          const isCurrent = user?.planTier === item.tier;
          const targetRank = getTierRank(item.tier);
          const yearly = formatPlanPrice(item, billingInterval);
          const isUpgrade = !isCurrent && targetRank > currentRank;
          // List-price difference against the plan in force, so the direction of
          // the change is legible before reading any feature list. Deliberately
          // worded per year rather than "you'll be charged": an upgrade bills
          // the full new price today, and a downgrade bills nothing at all
          // until the current term ends.
          const priceDelta =
            item.pricing && currentPlan.pricing
              ? item.pricing[billingInterval].amountCents - currentPlan.pricing[billingInterval].amountCents
              : item.pricing
                ? item.pricing[billingInterval].amountCents
                : currentPlan.pricing
                  ? -currentPlan.pricing[billingInterval].amountCents
                  : 0;
          return (
            <Card
              key={item.tier}
              accent={item.highlight || isCurrent}
              className="flex flex-col justify-between h-full gap-4 relative overflow-hidden"
              style={
                isCurrent
                  ? {
                      // The plan you're on should be findable at a glance in a row
                      // of four near-identical cards.
                      borderColor: colors.primary,
                      boxShadow: `0 0 0 1px ${colors.primary}55, 0 10px 30px ${colors.primary}1f`,
                    }
                  : undefined
              }
            >
              {isCurrent ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: colors.primary }}
                />
              ) : null}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3
                    className="text-xl font-bold"
                    style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {item.name}
                  </h3>
                  <div className="flex gap-1">
                    {isCurrent ? <Badge label="Current" variant="brand" /> : null}
                    {item.highlight && !isCurrent ? <Badge label="Popular" variant="success" /> : null}
                  </div>
                </div>

                <p className="text-xs mb-3" style={{ color: colors.inkMuted }}>
                  {item.tagline}
                </p>

                <div className="flex items-baseline mb-4">
                  <span className="text-3xl font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
                    {yearly.price}
                  </span>
                  <span className="text-xs ml-1" style={{ color: colors.inkMuted }}>
                    {yearly.priceNote}
                  </span>
                </div>

                <div className="space-y-2 border-t pt-3" style={{ borderColor: colors.border }}>
                  {item.features.map((f) => {
                    const markColor = !f.included
                      ? colors.inkFaint
                      : f.allPlans
                        ? colors.success
                        : f.fee
                          ? colors.warning
                          : colors.ink;
                    return (
                      <div key={f.label}>
                        <div className="flex items-center gap-2 text-xs">
                          <span style={{ color: markColor }}>{f.included ? '✓' : '○'}</span>
                          <span style={{ color: f.included ? (f.fee ? colors.warning : colors.ink) : colors.inkMuted }}>
                            {f.label}
                          </span>
                        </div>
                        {f.subItems?.map((sub) => (
                          <p key={sub} className="text-xs ml-5" style={{ color: colors.warning }}>
                            + {sub}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>

                <p className="text-[11px] mt-3" style={{ color: colors.inkFaint }}>
                  ○ not included · ✓ included ·{' '}
                  <span style={{ color: colors.success }}>green ✓</span> included on all plans ·{' '}
                  <span style={{ color: colors.warning }}>orange</span> fees applied to this tier
                </p>
              </div>

              {isCurrent ? (
                <div className="pt-4 mt-auto flex flex-col gap-1">
                  <Button
                    label="✓ Your Plan"
                    variant="secondary"
                    disabled
                    style={{
                      opacity: 1,
                      fontWeight: 'bold',
                      fontFamily: 'var(--font-space-grotesk)',
                      color: colors.primary,
                      borderColor: colors.primary,
                      backgroundColor: 'rgba(255,107,43,0.10)',
                    }}
                  />
                </div>
              ) : (
                <div className="pt-4 mt-auto flex flex-col gap-2">
                  {/* Direction and price change read together, above the button:
                      the one thing every card in this row needs to answer is
                      "is this a step up or down, and by how much". */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      label={isUpgrade ? '↑ Upgrade' : '↓ Move down'}
                      variant={isUpgrade ? 'brand' : 'info'}
                    />
                    {priceDelta !== 0 ? (
                      <span
                        className="text-[11px] font-bold tabular-nums"
                        style={{ color: priceDelta > 0 ? colors.inkMuted : colors.success }}
                      >
                        {priceDelta > 0 ? '+' : '−'}
                        {formatCad(Math.abs(priceDelta))}
                        {billingInterval === 'year' ? '/yr' : '/mo'}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    label={isUpgrade ? `Switch to ${item.name}` : `Move down to ${item.name}`}
                    // Both directions get a real, visible button — a downgrade
                    // people can't find is the bug this screen started with. The
                    // upgrade on the recommended tier is the only filled one, so
                    // the row still has a single loudest action.
                    variant={isUpgrade && item.highlight ? 'primary' : 'secondary'}
                    onClick={() => switchPlan(item.tier)}
                    loading={loadingTier === item.tier || loadingPortal}
                  />
                  {/* The two directions bill so differently that the button
                      alone would mislead: one charges a full year today, the
                      other charges nothing until the current term runs out. */}
                  <p className="text-[11px] text-center leading-snug" style={{ color: colors.inkFaint }}>
                    {isUpgrade
                      ? hasLiveSubscription(user?.subscriptionStatus)
                        ? 'Full price today, billed for a new year. Time left on your current plan isn’t credited.'
                        : 'Full price today, billed for a new year.'
                      : planChangeRoute(item.tier, user?.subscriptionStatus) === 'portal'
                        ? 'Takes effect when your current term ends. Nothing changes today.'
                        : 'Starts a new subscription at the lower price.'}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
