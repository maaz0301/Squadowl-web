'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Input, Modal, ModalFooter, PageHeader, Switch, useAlert } from '@/components/ui';
import {
  PLAN_DEFINITIONS,
  formatCad,
  formatPlanPrice,
  getPlanDefinition,
  getTeamAllowance,
  getTierRank,
  sellsExtraTeams,
  type PlanDefinition,
} from '@/data/plans';
import type { DiscountCodePreview, PlanTier } from '@/data/types';
import {
  buildDowngradeImpact,
  hasLiveSubscription,
  planChangeDirection,
  planChangeRoute,
  type DowngradeImpactLine,
} from '@/lib/planChange';
import { useUser } from '@/state/authStore';
import { getDataSource } from '@/data';
import {
  useApplyReferralCodeMutation,
  useAssessmentCountQuery,
  usePlatformBlockedFeaturesQuery,
  usePlatformBlockedPlanTiersQuery,
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
  const { data: blockedPlanTiers } = usePlatformBlockedPlanTiersQuery();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const loyaltyBlocked = (platformBlockedFeatures ?? []).includes('loyalty');
  // The downgrade confirmation's own dialog (see confirmDowngrade below) —
  // its impact list needs real structure (grouped, bulleted) that the shared
  // string-message Alert can't give it, so it keeps the same
  // resolve-a-promise shape as useAlert().confirm() but renders its own Modal.
  const [downgradeConfirm, setDowngradeConfirm] = useState<{
    tier: PlanTier;
    impact: DowngradeImpactLine[];
    resolve: (value: boolean) => void;
  } | null>(null);
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

  // Founder-issued discount code. Previewed here so the coach sees what they
  // get; create-checkout-session checks it again for the plan they pick.
  const [discountInput, setDiscountInput] = useState('');
  const [discount, setDiscount] = useState<Extract<DiscountCodePreview, { valid: true }> | null>(null);
  const [checkingDiscount, setCheckingDiscount] = useState(false);

  const creditCents = referralQuery.data?.balanceCents ?? 0;
  // Loyalty program is a platform-wide block: while it's off, existing credit
  // is neither shown nor spendable — the founder turning it off means turning
  // it off everywhere, not just hiding the referral/redeem screens.
  const hasCredit = creditCents > 0 && !loyaltyBlocked;
  // The discount is sized server-side against the real line total; this is
  // only whether to ask for it at all.
  // Checkout takes one discount, so an applied code holds the credit back.
  const useCredits = hasCredit && applyCredits && !discount;

  const applyDiscountCode = async () => {
    const codeValue = discountInput.trim();
    if (!codeValue) return;
    try {
      setCheckingDiscount(true);
      const result = await getDataSource().previewDiscountCode(codeValue);
      if (!result.valid) {
        await alert('Discount Code', result.message);
        return;
      }
      setDiscount(result);
      setDiscountInput('');
    } catch (e) {
      await alert('Discount Code', e instanceof Error ? e.message : 'That code could not be checked.');
    } finally {
      setCheckingDiscount(false);
    }
  };

  const discountSummary = discount
    ? `${discount.kind === 'percent' ? `${discount.percentOff}%` : formatCad(discount.amountOffCents ?? 0)} off ${
        discount.duration === 'forever'
          ? 'every payment'
          : discount.duration === 'repeating'
            ? `for ${discount.durationMonths} months`
            : 'your first payment'
      }${
        discount.planTiers.length
          ? ` · ${discount.planTiers.map((t) => getPlanDefinition(t as PlanTier).name).join(', ')} only`
          : ''
      }`
    : '';

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
        origin: window.location.origin,
        discountCode: discount?.code,
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
   * An **upgrade** with a live subscription goes through the Stripe portal,
   * which swaps the plan on the existing subscription and charges only the
   * prorated difference for the time left (the portal is configured for that —
   * see create-portal-session). It used to go through Checkout, which billed
   * the full price for a new year and forfeited the time already paid for; that
   * is what an upgrade from Coach to Coach+ charged CA$69.99 for. An account
   * with no live subscription still starts an ordinary Checkout.
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
      if (planChangeRoute(tier, user?.subscriptionStatus) === 'portal') {
        await openPortal();
        return;
      }
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
   * Only shown when there is a subscription to change — a first-time subscriber
   * goes straight to Checkout without an extra dialog in the way.
   */
  const confirmUpgrade = async (tier: PlanTier) => {
    if (!hasLiveSubscription(user?.subscriptionStatus)) return true;
    const target = getPlanDefinition(tier);
    return confirm({
      title: `Upgrade to ${target.name}?`,
      message:
        `You'll only pay the difference for the time left on your ${currentPlan.name} plan, not the full ` +
        `${target.name} price. You'll finish the change in Stripe, where the exact amount is shown before you confirm.`,
      confirmLabel: 'Continue',
    });
  };

  /** The "here's what this costs you" gate in front of a downgrade. */
  const confirmDowngrade = (tier: PlanTier) =>
    new Promise<boolean>((resolve) => {
      const impact = buildDowngradeImpact({
        from: currentTier,
        to: tier,
        teamCount: teamCountQuery.data,
        assessmentCount: assessmentCountQuery.data,
        extraTeamLicenses: currentLicenses,
      });
      setDowngradeConfirm({ tier, impact, resolve });
    });

  const closeDowngradeConfirm = (value: boolean) => {
    setDowngradeConfirm((d) => {
      d?.resolve(value);
      return null;
    });
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
      {!loyaltyBlocked &&
      referralQuery.data &&
      !referralQuery.data.redeemedByCode &&
      !hasLiveSubscription(user?.subscriptionStatus) ? (
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

      <Card className="mb-6 flex flex-col gap-2">
        <h3 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Have a discount code?
        </h3>
        {discount ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              <strong style={{ color: colors.success }}>{discount.code}</strong> — {discountSummary}. Applied when you
              choose a plan below.
              {hasCredit ? ' Your loyalty credit is saved for a later payment.' : ''}
            </p>
            <Button label="Remove" variant="ghost" onClick={() => setDiscount(null)} />
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="e.g. SPRING25"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={40}
              className="flex-1"
            />
            <Button
              label="Apply Code"
              variant="secondary"
              onClick={applyDiscountCode}
              loading={checkingDiscount}
              disabled={!discountInput.trim()}
            />
          </div>
        )}
      </Card>

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
          const isTierBlocked = !isCurrent && (blockedPlanTiers ?? []).includes(item.tier);
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
              ) : isTierBlocked ? (
                <div className="pt-4 mt-auto flex flex-col gap-2">
                  <Button label="Currently unavailable" variant="secondary" disabled />
                  <p className="text-[11px] text-center leading-snug" style={{ color: colors.inkFaint }}>
                    Not open for new signups or upgrades right now.
                  </p>
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
                      alone would mislead: one charges only the prorated
                      difference today, the other charges nothing until the current term runs out. */}
                  <p className="text-[11px] text-center leading-snug" style={{ color: colors.inkFaint }}>
                    {isUpgrade
                      ? hasLiveSubscription(user?.subscriptionStatus)
                        ? 'You only pay the difference for the time left on your current plan.'
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

      {downgradeConfirm ? (
        <DowngradeConfirmModal
          target={getPlanDefinition(downgradeConfirm.tier)}
          impact={downgradeConfirm.impact}
          onCancel={() => closeDowngradeConfirm(false)}
          onConfirm={() => closeDowngradeConfirm(true)}
        />
      ) : null}
    </>
  );
}

/**
 * The structured downgrade-impact dialog `confirmDowngrade` opens.
 *
 * Kept off the shared string-message Alert on purpose: this content is a
 * list of independent, differently-toned facts (a lost capability reads
 * nothing like "you're already over this limit"), and cramming it into one
 * paragraph — even a wrapped one — is what made this dialog hard to scan.
 * Grouping by DowngradeImpactLine's `kind` and giving each group its own
 * marker is the fix; the closing Stripe note stays visually separate so it
 * doesn't get lost with everything above it.
 */
function DowngradeConfirmModal({
  target,
  impact,
  onCancel,
  onConfirm,
}: {
  target: PlanDefinition;
  impact: DowngradeImpactLine[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useThemeColors();
  const lost = impact.filter((line) => line.kind === 'lost');
  const limits = impact.filter((line) => line.kind === 'limit');

  return (
    <Modal
      visible
      title={`Switch down to ${target.name}?`}
      size="md"
      onClose={onCancel}
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={onCancel} />
          <Button label={`Switch to ${target.name}`} variant="danger" onClick={onConfirm} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        {impact.length === 0 ? (
          <p className="text-[15px] leading-relaxed" style={{ color: colors.inkMuted }}>
            {target.name} covers everything you&rsquo;re using today.
          </p>
        ) : (
          <>
            {lost.length > 0 ? (
              <ImpactGroup heading="No longer included" tone="danger" lines={lost} />
            ) : null}
            {limits.length > 0 ? (
              <ImpactGroup heading="Limits that apply now" tone="warning" lines={limits} />
            ) : null}
          </>
        )}

        <p
          className="rounded-xl px-3.5 py-3 text-sm leading-relaxed"
          style={{ backgroundColor: colors.tile, color: colors.inkMuted }}
        >
          You&rsquo;ll finish the change in Stripe, where the new price and any credit for the rest of this
          term are shown before you confirm.
        </p>
      </div>
    </Modal>
  );
}

/** The rgba tints Badge already uses for these two tones, so the marker matches the app's existing color language. */
const IMPACT_TONE_BG: Record<'danger' | 'warning', string> = {
  danger: 'rgba(248,113,113,0.15)',
  warning: 'rgba(251,146,60,0.15)',
};

function ImpactGroup({
  heading,
  tone,
  lines,
}: {
  heading: string;
  tone: 'danger' | 'warning';
  lines: DowngradeImpactLine[];
}) {
  const colors = useThemeColors();
  const marker = tone === 'danger' ? '−' : '!';
  const fg = tone === 'danger' ? colors.danger : colors.warning;

  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: colors.inkFaint }}>
        {heading}
      </p>
      <ul className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ backgroundColor: IMPACT_TONE_BG[tone], color: fg }}
            >
              {marker}
            </span>
            <span className="text-[15px] leading-relaxed" style={{ color: colors.ink }}>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
