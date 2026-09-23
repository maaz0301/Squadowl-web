'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, LoadingState, PageHeader, Switch, useAlert } from '@/components/ui';
import { FounderNotAvailable, FounderSection } from '@/components/founder/FounderUi';
import {
  useIsFounderQuery,
  useSetPlatformBlockedFeaturesMutation,
  useSetPlatformBlockedPlanTiersMutation,
} from '@/features/founderQueries';
import { usePlatformBlockedFeaturesQuery, usePlatformBlockedPlanTiersQuery } from '@/features/queries';
import { BLOCKABLE_FEATURES, BLOCKABLE_FEATURE_LABEL, type BlockableFeature } from '@/lib/blockableFeatures';
import { PLAN_TIERS, type PlanTier } from '@/data/types';
import { getPlanDefinition } from '@/data/plans';

/**
 * Founder console — platform-wide kill switches: turning a section or plan
 * tier off here applies to every organization and every user at once, not
 * tied to any account. UI-level gate, not an RLS-backed boundary — see
 * src/lib/blockableFeatures.ts.
 */
export default function FounderFeatureBlocksPage() {
  const founderQuery = useIsFounderQuery();

  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;

  return (
    <>
      <PageHeader
        title="Feature Blocks"
        subtitle="Turn off a hub section or plan tier for the whole platform"
        showBack
        backHref="/founder"
      />
      <FounderSection title="Hub sections">
        <PlatformBlocksCard />
      </FounderSection>
      <FounderSection title="Plan tiers">
        <PlatformPlanTiersCard />
      </FounderSection>
    </>
  );
}

function PlatformBlocksCard() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const query = usePlatformBlockedFeaturesQuery();
  const update = useSetPlatformBlockedFeaturesMutation();
  // Which switch is mid-save, so only that one shows a spinner rather than
  // freezing every switch while one write is in flight.
  const [pending, setPending] = useState<BlockableFeature | null>(null);
  const blocked = new Set(query.data ?? []);

  const toggle = async (feature: BlockableFeature, checked: boolean) => {
    const next = new Set(blocked);
    if (checked) next.add(feature);
    else next.delete(feature);
    setPending(feature);
    try {
      await update.mutateAsync(Array.from(next));
    } catch (e) {
      await alert('Could Not Update', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  };

  return (
    <Card accent className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: colors.inkMuted }}>
        Applies to every organization and every user at once — not tied to any specific account.
      </p>
      {query.isLoading ? (
        <LoadingState message="Loading..." />
      ) : (
        <div className="flex flex-col gap-2">
          {BLOCKABLE_FEATURES.map((feature) => (
            <div key={feature} className="flex items-center justify-between gap-2">
              <Switch
                checked={blocked.has(feature)}
                onChange={(v) => toggle(feature, v)}
                disabled={pending !== null}
                label={`${BLOCKABLE_FEATURE_LABEL[feature]} — blocked for everyone`}
              />
              {pending === feature ? (
                <span className="text-xs" style={{ color: colors.inkFaint }}>
                  Saving…
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PlatformPlanTiersCard() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const query = usePlatformBlockedPlanTiersQuery();
  const update = useSetPlatformBlockedPlanTiersMutation();
  const [pending, setPending] = useState<PlanTier | null>(null);
  const blocked = new Set(query.data ?? []);

  const toggle = async (tier: PlanTier, checked: boolean) => {
    const next = new Set(blocked);
    if (checked) next.add(tier);
    else next.delete(tier);
    setPending(tier);
    try {
      await update.mutateAsync(Array.from(next));
    } catch (e) {
      await alert('Could Not Update', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  };

  return (
    <Card accent className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: colors.inkMuted }}>
        Hides checkout/upgrade for one plan tier platform-wide. Anyone already subscribed to it keeps their plan —
        this only stops new signups and upgrades into it.
      </p>
      {query.isLoading ? (
        <LoadingState message="Loading..." />
      ) : (
        <div className="flex flex-col gap-2">
          {PLAN_TIERS.map((tier) => (
            <div key={tier} className="flex items-center justify-between gap-2">
              <Switch
                checked={blocked.has(tier)}
                onChange={(v) => toggle(tier, v)}
                disabled={pending !== null}
                label={`${getPlanDefinition(tier).name} — unavailable for new signups/upgrades`}
              />
              {pending === tier ? (
                <span className="text-xs" style={{ color: colors.inkFaint }}>
                  Saving…
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
