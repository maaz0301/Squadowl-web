'use client';

import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, useAlert } from '@/components/ui';
import { useImpersonation } from '@/features/useImpersonation';
import { daysUntil } from '@/lib/accountAccess';
import { BLOCKABLE_FEATURE_LABEL, type BlockableFeature } from '@/lib/blockableFeatures';
import { useAuthStore, useUser } from '@/state/authStore';

/** Replaces every screen for a member whose organization is suspended. */
/** Pinned while the founder is viewing the app as an organization or one of its users. */
export function ImpersonationBanner() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const { target, pending, exit } = useImpersonation();
  if (!target) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-20 -mx-4 -mt-6 mb-5 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      style={{ backgroundColor: 'rgba(56,189,248,0.14)', borderColor: 'rgba(56,189,248,0.35)' }}
    >
      <p className="min-w-0 text-sm break-words" style={{ color: colors.ink }}>
        {target.user ? (
          <>
            Viewing as <strong>{target.user.name || target.user.email || 'user'}</strong>
            {target.user.name && target.user.email ? ` (${target.user.email})` : ''} from {target.accountName}
          </>
        ) : (
          <>
            Viewing as <strong>{target.accountName}</strong>
          </>
        )}{' '}
        · read-only · recorded in the audit log
      </p>
      <Button
        label="Exit View As"
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          exit().catch((e) => alert('Could Not Exit', e instanceof Error ? e.message : 'Something went wrong.'))
        }
      />
    </div>
  );
}

export function SuspendedAccountScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const trialEnded = !!user?.trialExpired;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-10">
      <Card accent className="flex flex-col gap-3">
        <h1 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {trialEnded ? 'Your trial has ended' : 'Your organization is suspended'}
        </h1>
        <p className="text-sm break-words" style={{ color: colors.inkMuted }}>
          {user?.organization ? <strong>{user.organization}</strong> : 'This account'}{' '}
          {trialEnded
            ? 'no longer has access. Your teams and evaluations are safe — contact SquadOwl to continue.'
            : 'has been suspended. Your data has not been deleted — contact SquadOwl to restore access.'}
        </p>
        {user?.suspendedReason ? (
          <p className="text-sm break-words" style={{ color: colors.inkMuted }}>
            Reason: {user.suspendedReason}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button label="Email founder@tryout.ca" onClick={() => (window.location.href = 'mailto:founder@tryout.ca')} />
          <Button
            label="Sign out"
            variant="ghost"
            onClick={async () => {
              await logout();
              router.push('/login');
            }}
          />
        </div>
      </Card>
    </div>
  );
}

/** Replaces one section for an account whose founder has turned that section off. */
export function FeatureBlockedScreen({ feature }: { feature: BlockableFeature }) {
  const colors = useThemeColors();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-10">
      <Card accent className="flex flex-col gap-3">
        <h1 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {BLOCKABLE_FEATURE_LABEL[feature]} is unavailable
        </h1>
        <p className="text-sm break-words" style={{ color: colors.inkMuted }}>
          The rest of your account is unaffected — contact SquadOwl if you think this is a mistake.
        </p>
        <div>
          <Button label="Email founder@tryout.ca" onClick={() => (window.location.href = 'mailto:founder@tryout.ca')} />
        </div>
      </Card>
    </div>
  );
}

/** Quiet countdown for a founder-granted trial in its last week. */
export function TrialEndingNotice() {
  const colors = useThemeColors();
  const user = useUser();
  if (user?.accessStatus !== 'trial' || !user.trialEndsAt || user.impersonating) return null;
  const days = daysUntil(user.trialEndsAt);
  if (days > 7) return null;

  return (
    <p
      className="mb-4 rounded-xl border px-3 py-2 text-sm"
      style={{ borderColor: 'rgba(56,189,248,0.35)', color: colors.ink }}
    >
      Your trial ends in {days} day{days === 1 ? '' : 's'}.
    </p>
  );
}
