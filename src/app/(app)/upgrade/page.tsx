'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, PageHeader, useAlert } from '@/components/ui';
import {
  PLAN_DEFINITIONS,
  formatCad,
  formatPlanPrice,
  getPlanDefinition,
  getTeamAllowance,
  sellsExtraTeams,
} from '@/data/plans';
import { useUser } from '@/state/authStore';
import { getDataSource } from '@/data';

const TIER_RANKS: Record<string, number> = {
  free: 0,
  coach: 1,
  coach_plus: 2,
  club: 3,
};

export default function UpgradePage() {
  const colors = useThemeColors();
  const user = useUser();
  const { alert } = useAlert();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [extraTeams, setExtraTeams] = useState(1);
  const [buyingTeams, setBuyingTeams] = useState(false);
  // Monthly billing is temporarily hidden — every checkout goes through yearly for now,
  // matching the mobile app.
  const billingInterval = 'year' as const;

  const openPortal = async () => {
    try {
      setLoadingPortal(true);
      const res = await getDataSource().createPortalSession();
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      await alert('Portal Error', err instanceof Error ? err.message : 'Something went wrong opening subscription portal.');
    } finally {
      setLoadingPortal(false);
    }
  };

  const upgrade = async (tier: typeof PLAN_DEFINITIONS[number]['tier']) => {
    try {
      setLoadingTier(tier);
      const res = await getDataSource().createCheckoutSession(tier, billingInterval);
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

  const currentRank = TIER_RANKS[user?.planTier ?? 'free'] ?? 0;
  const currentTier = user?.planTier ?? 'free';
  const currentLicenses = user?.extraTeamLicenses ?? 0;
  const currentPlan = getPlanDefinition(currentTier);
  const canBuyTeams = sellsExtraTeams(currentTier);
  const extraTeamPrice = currentPlan.extraTeamPriceCents ?? 0;

  // Extra teams are an add-on subscription on top of the current plan (Club only), so
  // this checkout must not go through `upgrade` — that one switches the plan tier.
  const buyTeams = async () => {
    try {
      setBuyingTeams(true);
      const res = await getDataSource().createTeamLicenseCheckoutSession(extraTeams);
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

      {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing' ? (
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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_DEFINITIONS.map((item) => {
          const isCurrent = user?.planTier === item.tier;
          const targetRank = TIER_RANKS[item.tier] ?? 0;
          const yearly = formatPlanPrice(item, billingInterval);
          return (
            <Card
              key={item.tier}
              accent={item.highlight}
              className="flex flex-col justify-between h-full gap-4 relative"
            >
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

              {targetRank > currentRank ? (
                <div className="pt-4 mt-auto">
                  <Button
                    label={`Switch to ${item.name}`}
                    variant={item.highlight ? 'primary' : 'secondary'}
                    onClick={() => upgrade(item.tier)}
                    loading={loadingTier === item.tier}
                  />
                </div>
              ) : isCurrent ? (
                <div className="pt-4 mt-auto">
                  <Button label="Active Plan" variant="ghost" disabled />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
