'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useUser } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';

type Feature = keyof ReturnType<typeof getPlanDefinition>['limits'];

interface Props {
  feature: Feature;
  children?: ReactNode;
  title?: string;
  /**
   * Gate against this tier instead of the caller's own account tier. Team
   * screens pass effectiveTierForTeam's result here so a delegated (CLUB
   * mode) team gates on the owning club's plan, not the delegate's own.
   */
  tierOverride?: PlanTier;
}

const PLAN_REQUIRED: Partial<Record<Feature, PlanTier>> = {
  customRubrics: 'coach',
  exports: 'coach',
  teamBuilder: 'coach_plus',
  aiSummaries: 'coach_plus',
  aiReportComments: 'club',
  shareLinks: 'coach_plus',
  seasonHub: 'coach',
  guardianPortal: 'coach',
  enterprise: 'club',
  teamManagers: 'coach_plus',
  qrRegistration: 'free',
  payments: 'coach',
};

function planLabel(tier: PlanTier): string {
  return tier === 'coach_plus' ? 'Coach+' : tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function PlanGate({ feature, children, title, tierOverride }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const tier = tierOverride ?? user?.planTier ?? 'free';
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  if (canUseFeature(tier, feature)) return <>{children}</>;

  const required = PLAN_REQUIRED[feature] ?? 'club';

  return (
    <Card accent className="my-4 flex flex-col items-start gap-3">
      <h3 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {title ?? 'Upgrade Required'}
      </h3>
      <p style={{ color: colors.inkMuted }}>
        This feature requires the {planLabel(required)} plan or higher. You&apos;re on {planLabel(tier)}.
      </p>
      {billingBlocked ? (
        <Button label="Upgrades unavailable right now" variant="secondary" disabled />
      ) : (
        <Button label="View Plans" onClick={() => router.push('/upgrade')} />
      )}
    </Card>
  );
}
