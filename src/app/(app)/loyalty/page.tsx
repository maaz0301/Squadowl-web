'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, SectionLabel, useAlert } from '@/components/ui';
import { formatCad } from '@/data/plans';
import { useReferralSummaryQuery, usePlatformBlockedFeaturesQuery } from '@/features/queries';
import type { ReferralLedgerEntry } from '@/data/types';

const REFERRAL_BONUS_CENTS = 100;

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function LedgerRow({ entry }: { entry: ReferralLedgerEntry }) {
  const colors = useThemeColors();
  const credited = entry.amountCents > 0;
  return (
    <div className="flex items-center justify-between border-t py-2" style={{ borderColor: colors.border }}>
      <div className="flex-1 pr-3">
        <p style={{ color: colors.ink }}>{entry.note ?? (credited ? 'Credit' : 'Redeemed')}</p>
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          {formatEntryDate(entry.created_at)}
        </p>
      </div>
      <p className="font-bold" style={{ color: credited ? colors.success : colors.inkMuted, fontFamily: 'var(--font-space-grotesk)' }}>
        {credited ? '+' : '−'}
        {formatCad(Math.abs(entry.amountCents))}
      </p>
    </div>
  );
}

export default function LoyaltyPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const { alert } = useAlert();
  const summaryQuery = useReferralSummaryQuery();
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  if (summaryQuery.isLoading) return <LoadingState message="Loading your loyalty program..." />;
  if (summaryQuery.isError) {
    return (
      <ErrorState
        message={summaryQuery.error instanceof Error ? summaryQuery.error.message : 'Could not load your loyalty program.'}
        onRetry={() => summaryQuery.refetch()}
      />
    );
  }

  const summary = summaryQuery.data;
  const code = summary?.code ?? null;
  const balanceCents = summary?.balanceCents ?? 0;
  const earnedCents = summary?.earnedLastYearCents ?? 0;
  const capCents = summary?.annualCapCents ?? 6000;
  const remainingCents = Math.max(0, capCents - earnedCents);
  const pending = Math.max(0, (summary?.referredCount ?? 0) - (summary?.convertedCount ?? 0));

  const signupLink = (c: string) =>
    typeof window !== 'undefined' ? `${window.location.origin}/signup?ref=${encodeURIComponent(c)}` : '';

  const shareCode = async () => {
    if (!code) return;
    const link = signupLink(code);
    const message =
      `Join me on SquadOwl, sign up with my referral code applied: ${link}\n\n` +
      `Or enter this code by hand when you sign up: ${code}`;

    // A real https:// link, so it linkifies wherever it lands — unlike a bare
    // custom URL scheme, which most messaging/email clients won't turn blue.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Join me on SquadOwl', text: message, url: link });
        return;
      } catch {
        // User canceled the native share sheet, or it isn't actually wired up
        // (some desktop browsers report navigator.share but reject the call) —
        // either way, fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      await alert('Copied', 'Your referral link and code were copied to the clipboard.');
    } catch {
      await alert('Your Referral Link', message);
    }
  };

  return (
    <div className="w-full max-w-5xl">
      <PageHeader title="Loyalty Program" subtitle="Refer coaches, earn credit" showBack backHref="/profile" />

      {/* Code + balance */}
      <Card accent className="mt-4 mb-4 flex flex-col gap-3">
        <span className="text-xs uppercase" style={{ color: colors.inkFaint }}>
          Your referral code
        </span>
        {code ? (
          <button type="button" onClick={shareCode} className="text-left">
            <p
              className="text-3xl font-bold tracking-widest"
              style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {code}
            </p>
            <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
              Click to copy a shareable link with friends, family, and colleagues.
            </p>
          </button>
        ) : (
          <p style={{ color: colors.inkMuted }}>Your code couldn&apos;t be set up just now. Try again in a moment.</p>
        )}
        {code ? (
          <Button label="Share My Code" onClick={shareCode} />
        ) : (
          <Button label="Retry" variant="secondary" onClick={() => summaryQuery.refetch()} loading={summaryQuery.isFetching} />
        )}
      </Card>

      <Card className="mb-4 flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs uppercase" style={{ color: colors.inkFaint }}>
              Available credit
            </span>
            <p className="text-3xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              {formatCad(balanceCents)}
            </p>
          </div>
          {balanceCents > 0 ? <Badge label="Ready to redeem" variant="success" /> : null}
        </div>
        <p className="text-xs" style={{ color: colors.inkMuted }}>
          {formatCad(earnedCents)} of {formatCad(capCents)} earned in the last 12 months
          {remainingCents > 0
            ? ` · ${formatCad(remainingCents)} still available to earn this year.`
            : ' · you have reached this year’s maximum.'}
        </p>
        {balanceCents > 0 && !billingBlocked ? (
          <Button label="Redeem on a Subscription" className="mt-1" onClick={() => router.push('/upgrade')} />
        ) : null}
      </Card>

      {/* Referral counts */}
      <Card className="mb-4 flex flex-col gap-2">
        <SectionLabel>Your Referrals</SectionLabel>
        <div className="flex justify-between">
          <span style={{ color: colors.inkMuted }}>Signed up with your code</span>
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            {summary?.referredCount ?? 0}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: colors.inkMuted }}>Subscribed and paid out</span>
          <span className="font-bold" style={{ color: colors.success, fontFamily: 'var(--font-space-grotesk)' }}>
            {summary?.convertedCount ?? 0}
          </span>
        </div>
        {pending > 0 ? (
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            {pending} {pending === 1 ? 'person has' : 'people have'} signed up but not subscribed yet — credit lands
            when they do.
          </p>
        ) : null}
      </Card>

      {/* Explainer — the "how to / benefits" button from the request. */}
      <Card className="mb-4 flex flex-col gap-2">
        <Button
          label={showHowItWorks ? 'Hide How It Works' : 'How the Loyalty Program Works'}
          variant="secondary"
          onClick={() => setShowHowItWorks((v) => !v)}
        />
        {showHowItWorks ? (
          <div className="mt-2 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                1. Share your code
              </p>
              <p style={{ color: colors.inkMuted }}>
                Every account gets its own 9-character code. Send it to friends, family, or colleagues who coach.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                2. They enter it when they subscribe
              </p>
              <p style={{ color: colors.inkMuted }}>
                They add your code on the Upgrade Plan screen before their first paid subscription. It can only be
                applied once, and not after they have already subscribed.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                3. You earn {formatCad(REFERRAL_BONUS_CENTS)} per subscriber
              </p>
              <p style={{ color: colors.inkMuted }}>
                Credit lands automatically once their payment goes through — up to {formatCad(capCents)} per year.
                Nothing is earned for a signup that never subscribes.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                4. Spend it on your own plan
              </p>
              <p style={{ color: colors.inkMuted }}>
                Your balance can be applied to any subscription payment from the Upgrade Plan screen. Whatever you
                don&apos;t use stays on your account for next time.
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Ledger */}
      <Card className="mb-4 flex flex-col gap-1">
        <SectionLabel>Account Ledger</SectionLabel>
        {summary?.entries?.length ? (
          summary.entries.map((entry) => <LedgerRow key={entry.id} entry={entry} />)
        ) : (
          <p className="py-2 text-sm" style={{ color: colors.inkMuted }}>
            No activity yet. Your first referral credit will show up here.
          </p>
        )}
      </Card>

      {summary?.redeemedByCode ? (
        <p className="mb-4 text-center text-xs" style={{ color: colors.inkFaint }}>
          You joined with referral code {summary.redeemedByCode}.
        </p>
      ) : null}
    </div>
  );
}
