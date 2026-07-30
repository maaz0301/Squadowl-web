'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, PageHeader, useAlert } from '@/components/ui';
import { PLAN_DEFINITIONS } from '@/data/plans';
import { useUser } from '@/state/authStore';
import { getDataSource } from '@/data';

const TIER_RANKS: Record<string, number> = {
  free: 0,
  coach: 1,
  club: 2,
  pro: 3,
  association: 4,
};

export default function UpgradePage() {
  const colors = useThemeColors();
  const user = useUser();
  const { alert } = useAlert();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);

  const openPortal = async () => {
    try {
      setLoadingPortal(true);
      const res = await getDataSource().createPortalSession();
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      await alert('Portal Error', err?.message || 'Something went wrong opening subscription portal.');
    } finally {
      setLoadingPortal(false);
    }
  };

  const upgrade = async (tier: typeof PLAN_DEFINITIONS[number]['tier']) => {
    try {
      setLoadingTier(tier);
      const res = await getDataSource().createCheckoutSession(tier);
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      await alert('Checkout Error', err?.message || 'Something went wrong creating checkout session.');
    } finally {
      setLoadingTier(null);
    }
  };

  const currentRank = TIER_RANKS[user?.planTier ?? 'free'] ?? 0;

  return (
    <>
      <PageHeader
        title="Upgrade Plan"
        subtitle={`Current Plan: ${(user?.planTier ?? 'free').toUpperCase()}`}
        showBack
        backHref="/profile"
      />

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
          return (
            <Card
              key={item.tier}
              accent={item.highlight}
              className="flex flex-col justify-between h-full gap-4 relative"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
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

                <div className="flex items-baseline mb-4">
                  <span className="text-3xl font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
                    {item.price}
                  </span>
                  {item.priceNote ? (
                    <span className="text-xs ml-1" style={{ color: colors.inkMuted }}>
                      {item.priceNote}
                    </span>
                  ) : null}
                </div>

                <div className="space-y-2 border-t pt-3" style={{ borderColor: colors.border }}>
                  {item.features.map((f) => (
                    <div key={f.label} className="flex items-center gap-2 text-xs">
                      <span style={{ color: f.included ? colors.success : colors.inkFaint }}>
                        {f.included ? '✓' : '○'}
                      </span>
                      <span style={{ color: f.included ? colors.ink : colors.inkMuted }}>
                        {f.label}
                      </span>
                    </div>
                  ))}
                </div>
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
