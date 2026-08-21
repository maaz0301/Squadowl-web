'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, Button } from '@/components/ui';
import { getNextTier, sellsExtraTeams, usageFraction } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useUser } from '@/state/authStore';
import {
  NUDGE_THRESHOLD,
  buildLimitReachedMessage,
  buildNudgeMessage,
  effectiveLimit,
  type UsageMetric,
} from '@/lib/usageNudges';

interface Props {
  tier: PlanTier;
  metric: UsageMetric;
  count: number;
  /** Plural noun shown in the message, e.g. "players", "teams". Defaults to `metric`. */
  label?: string;
}

/** Shows nothing unless usage is at/above 85% of the plan's limit.
 *
 * Deliberate divergence from mobile: mobile also hides this at 100% (`atLimit`),
 * on the grounds that LimitReachedModal covers that case. But that modal only
 * appears once you click "+ New Team", so a full account saw nothing at all on
 * the page itself — the warning went quiet exactly when it mattered most. Web
 * keeps the banner up at the limit and switches to the harder
 * buildLimitReachedMessage() copy. Mobile is intentionally left as-is. */
export function UsageNudgeBanner({ tier, metric, count, label }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const [dismissed, setDismissed] = useState(false);

  const extraTeamLicenses = user?.extraTeamLicenses ?? 0;
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  const fraction = usageFraction(limit, count);
  const atLimit = limit !== 'unlimited' && count >= limit;
  const nounLabel = label ?? metric;

  if (dismissed || limit === 'unlimited' || fraction < NUDGE_THRESHOLD) return null;

  // Club has no tier above it, but it can still buy teams — so the CTA stays useful there.
  const canBuyTeams = metric === 'teams' && sellsExtraTeams(tier);
  const ctaLabel = canBuyTeams ? 'Add Teams' : getNextTier(tier) ? 'Upgrade' : null;
  const message = atLimit
    ? buildLimitReachedMessage(tier, metric, nounLabel, extraTeamLicenses)
    : buildNudgeMessage(tier, metric, count, nounLabel, extraTeamLicenses);

  return (
    <Card
      className="mb-3 flex items-center gap-3"
      // Being full is a harder state than approaching full, so it reads red.
      style={{ borderLeftWidth: 3, borderLeftColor: atLimit ? colors.danger : colors.warning }}
    >
      <span className="flex-1 text-sm" style={{ color: colors.ink }}>
        {message}
      </span>
      <div className="flex flex-col items-end gap-2">
        {ctaLabel ? <Button label={ctaLabel} size="sm" onClick={() => router.push('/upgrade')} /> : null}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-center text-xs"
          style={{ color: colors.inkMuted }}
        >
          Dismiss
        </button>
      </div>
    </Card>
  );
}
