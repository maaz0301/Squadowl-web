'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useUser } from '@/state/authStore';

type Feature = keyof ReturnType<typeof getPlanDefinition>['limits'];

interface Props {
  feature: Feature;
  children?: ReactNode;
  title?: string;
}

const PLAN_REQUIRED: Partial<Record<Feature, PlanTier>> = {
  teamBuilder: 'club',
  aiSummaries: 'club',
  shareLinks: 'club',
  seasonHub: 'coach',
  guardianPortal: 'coach',
  enterprise: 'association',
  qrRegistration: 'coach',
};

export function PlanGate({ feature, children, title }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const tier = user?.planTier ?? 'free';

  if (canUseFeature(tier, feature)) return <>{children}</>;

  const required = PLAN_REQUIRED[feature] ?? 'club';

  return (
    <Card accent className="my-4 flex flex-col items-start gap-3">
      <h3 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {title ?? 'Upgrade Required'}
      </h3>
      <p style={{ color: colors.inkMuted }}>
        This feature requires the {required.charAt(0).toUpperCase() + required.slice(1)} plan or higher.
        You&apos;re on {tier}.
      </p>
      <Button label="View Plans" onClick={() => router.push('/upgrade')} />
    </Card>
  );
}
