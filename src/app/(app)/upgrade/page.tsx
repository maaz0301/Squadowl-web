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
  downgradeRoute,
  hasLiveSubscription,
  planChangeDirection,
} from '@/lib/planChange';
import { useUser } from '@/state/authStore';
import { getDataSource } from '@/data';
import {
  useApplyReferralCodeMutation,
  useAssessmentCountQuery,
  useReferralSummaryQuery,
  useTeamCountQuery,
} from '@/features/queries';

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
  const canBuyTeams = sellsExtraTeams(currentTier);
  const extraTeamPrice = currentPlan.extraTeamPriceCents ?? 0;

  /**
   * Switches to any tier, in either direction.
   *
   * A downgrade is confirmed first — with what it actually costs the account,
   * built from the two plans and the current usage — and then routed by
   * downgradeRoute(): the Stripe Customer Portal while a subscription is live,
   * because swapping the plan there replaces the existing subscription instead
   * of starting a second one alongside it, and an ordinary Checkout only when
   * there is no live subscription for the portal to manage.
   */
  const switchPlan = async (tier: PlanTier) => {
    if (planChangeDirection(currentTier, tier) !== 'downgrade') {
      await startCheckout(tier);
      return;
    }

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
    if (!ok) return;

    if (downgradeRoute(tier, user?.subscriptionStatus) === 'portal') {
      await openPortal();
      return;
    }
    await startCheckout(tier);
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
              Active Subscription
            </h3>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Manage billing details, view payment history, or update tier in the Stripe Customer Portal.
            </p>
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
          const isDowngrade = !isCurrent && targetRank < currentRank;
          const isUpgrade = !isCurrent && targetRank > currentRank;
          // List-price difference against the plan in force, so the direction of
          // the change is legible before reading any feature list. Stripe still
          // shows what is actually owed today — proration is settled there, not
          // here — so this is deliberately worded per year, not "you'll be charged".
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
                    loading={loadingTier === item.tier || (isDowngrade && loadingPortal)}
                  />
                  {isDowngrade ? (
                    <p className="text-[11px] text-center leading-snug" style={{ color: colors.inkFaint }}>
                      {downgradeRoute(item.tier, user?.subscriptionStatus) === 'portal'
                        ? 'Confirmed in Stripe, with any credit for the rest of your term.'
                        : 'Starts a new subscription at the lower price.'}
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
