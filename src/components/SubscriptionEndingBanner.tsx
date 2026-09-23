'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, Button } from '@/components/ui';
import { hasLiveSubscription } from '@/lib/planChange';
import { getPlanDefinition } from '@/data/plans';
import { useUser } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';
import { dismissPlanNotice, isPlanNoticeDismissed } from '@/lib/planNoticeSession';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * App-wide notice that a plan change is already scheduled — mounted in AppShell
 * so it follows the coach to whatever page they're on, not only /upgrade.
 *
 * Both of the changes it reports are deliberately deferred to the end of the
 * paid term, which means neither of them alters anything the coach can see at
 * the moment they choose it: a cancellation leaves the subscription `active`,
 * and a downgrade leaves the current price running while Stripe holds the lower
 * one in a schedule. Without this the only available reading is "I chose it and
 * nothing happened" — which is exactly how both were first reported as bugs.
 *
 * Shown as soon as the coach logs in, and stays until they dismiss it; after
 * that it is not shown again in this login session (see planNoticeSession).
 *
 * Suppressed on /upgrade itself, where the same dates are already shown in the
 * subscription card with the full restart flow attached.
 */
export function SubscriptionEndingBanner() {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const user = useUser();
  const [, rerender] = useState(0);
  const dismissed = isPlanNoticeDismissed(user?.id);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  const cancelAt = user?.subscriptionCancelAt;
  const pendingTier = user?.pendingPlanTier;
  const pendingAt = user?.pendingPlanChangeAt;

  // A cancellation outranks a scheduled downgrade: if the subscription is ending
  // outright, the tier it would have moved to on the way is beside the point.
  const kind = cancelAt != null ? 'cancel' : pendingTier && pendingAt != null ? 'downgrade' : null;

  const showable =
    !dismissed &&
    !pathname?.startsWith('/upgrade') &&
    kind != null &&
    hasLiveSubscription(user?.subscriptionStatus);

  if (!showable) return null;

  const planName = getPlanDefinition(user!.planTier).name;

  const message =
    kind === 'cancel' ? (
      <>
        Cancelled — your {planName} plan stays active until{' '}
        <strong>{formatDate(cancelAt!)}</strong>, then the account moves to Free. You can restart it
        any time before then.
      </>
    ) : (
      <>
        Your plan changes from {planName} to {getPlanDefinition(pendingTier!).name} on{' '}
        <strong>{formatDate(pendingAt!)}</strong>. You keep {planName} until then — nothing changes
        today.
      </>
    );

  return (
    <Card
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
      style={{ borderLeftWidth: 3, borderLeftColor: colors.warning }}
    >
      <span className="min-w-[10rem] flex-1 text-sm" style={{ color: colors.ink }}>
        {message}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {!billingBlocked ? <Button label="Manage Plan" size="sm" onClick={() => router.push('/upgrade')} /> : null}
        <button
          type="button"
          onClick={() => {
            if (user) dismissPlanNotice(user.id);
            rerender((n) => n + 1);
          }}
          className="min-h-[40px] px-1 text-xs"
          style={{ color: colors.inkMuted }}
        >
          Dismiss
        </button>
      </div>
    </Card>
  );
}
