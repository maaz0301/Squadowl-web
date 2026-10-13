'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, ErrorState, LoadingState } from '@/components/ui';
import {
  useEmailActivityQuery,
  useFounderDashboardQuery,
  usePaymentsQuery,
  useRevenueQuery,
} from '@/features/founderQueries';
import { summarizeRevenue } from '@/lib/revenue';
import { formatMoney } from './billing/format';
import { FounderSection } from './FounderUi';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'ok' }) {
  const colors = useThemeColors();
  return (
    <Card className="flex flex-col gap-0.5">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkFaint }}>
        {label}
      </p>
      <p
        className="text-2xl font-bold"
        style={{ color: tone === 'bad' ? colors.danger : tone === 'ok' ? colors.success : colors.ink }}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-xs" style={{ color: colors.inkMuted }}>
          {hint}
        </p>
      ) : null}
    </Card>
  );
}

const grid = 'grid grid-cols-2 gap-2 md:grid-cols-4';

/**
 * Mission control: business numbers, what is happening now and system warning
 * lights. The counts come from one database function; MRR, failed payments and
 * failed emails come from Stripe and SendGrid, so a failure there only blanks
 * its own tile, never the page.
 */
export function FounderDashboard() {
  const colors = useThemeColors();
  const stats = useFounderDashboardQuery();
  const revenue = useRevenueQuery(3);
  const failedPayments = usePaymentsQuery({ status: 'failed' });
  const failedEmails = useEmailActivityQuery({ status: 'not_delivered', days: 7 });
  const mrr = useMemo(() => (revenue.data ? summarizeRevenue(revenue.data) : null), [revenue.data]);

  if (stats.isLoading) return <LoadingState message="Loading dashboard..." />;
  if (stats.isError || !stats.data) {
    return <ErrorState message="Could not load the dashboard." onRetry={() => stats.refetch()} />;
  }
  const s = stats.data;
  const signupDelta = s.signups_7d - s.signups_prev_7d;
  const free = Math.max(0, s.clubs_total - s.paying - s.trial - s.comp);
  const failedPaymentCount = failedPayments.data?.pages.reduce((n, p) => n + p.items.length, 0);

  return (
    <>
      <FounderSection title="Business">
        <div className={grid}>
          <Tile label="Total clubs" value={s.clubs_total.toLocaleString()} hint={`${s.clubs_new_7d} new this week, ${s.clubs_new_30d} in 30 days`} />
          <Tile label="Active users" value={s.users_active_30d.toLocaleString()} hint={`${s.users_active_7d.toLocaleString()} in the last 7 days, of ${s.users_total.toLocaleString()} total`} />
          <Tile
            label="New sign-ups this week"
            value={s.signups_7d.toLocaleString()}
            hint={`${signupDelta >= 0 ? '+' : ''}${signupDelta} vs the week before`}
          />
          <Tile label="MRR" value={mrr ? formatMoney(mrr.mrrCents) : revenue.isError ? 'Unavailable' : '...'} hint={mrr ? `${mrr.subscribers} paying subscribers` : 'From Stripe'} />
          <Tile label="Paying" value={s.paying.toLocaleString()} hint="Clubs with a live subscription" />
          <Tile label="On trial" value={s.trial.toLocaleString()} />
          <Tile label="Comp / free" value={`${s.comp} / ${free}`} hint="Comp access, and no paid plan" />
          <Tile
            label="Cancellations"
            value={(s.canceling + s.canceled).toLocaleString()}
            hint={`${s.canceling} ending at period end, ${s.canceled} already canceled`}
            tone={s.canceling + s.canceled > 0 ? 'bad' : undefined}
          />
        </div>
      </FounderSection>

      <FounderSection title="Right now">
        <div className={grid}>
          <Tile label="Events today" value={s.tryouts_today.toLocaleString()} hint="Tryouts and events dated today" />
          <Tile label="Evaluations today" value={s.evaluations_today.toLocaleString()} hint={`${s.evaluations_7d.toLocaleString()} in the last 7 days`} />
        </div>
        <Card className="flex flex-col gap-1">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkFaint }}>
            Most active clubs (7 days)
          </p>
          {s.top_clubs.length === 0 ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              No evaluations submitted this week.
            </p>
          ) : (
            s.top_clubs.map((c) => (
              <Link
                key={c.accountId}
                href={`/founder/organizations/${c.accountId}`}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                style={{ color: colors.ink }}
              >
                <span className="min-w-0 break-words font-semibold">{c.name || 'Untitled organization'}</span>
                <span style={{ color: colors.inkMuted }}>
                  {c.evaluations} evaluations across {c.tryouts} events
                </span>
              </Link>
            ))
          )}
        </Card>
      </FounderSection>

      <FounderSection title="System health">
        <div className={grid}>
          <Tile
            label="Failed payments"
            value={failedPaymentCount === undefined ? (failedPayments.isError ? 'Unavailable' : '...') : failedPaymentCount.toLocaleString()}
            hint={`${s.past_due} clubs past due`}
            tone={(failedPaymentCount ?? 0) > 0 || s.past_due > 0 ? 'bad' : 'ok'}
          />
          <Tile
            label="Failed emails (7 days)"
            value={failedEmails.data ? failedEmails.data.length.toLocaleString() : failedEmails.isError ? 'Unavailable' : '...'}
            hint="Not delivered, from SendGrid"
            tone={(failedEmails.data?.length ?? 0) > 0 ? 'bad' : 'ok'}
          />
          <Tile label="Database size" value={formatBytes(s.db_size_bytes)} hint="Supabase Postgres" />
          <Tile label="Suspended clubs" value={s.suspended.toLocaleString()} tone={s.suspended > 0 ? 'bad' : 'ok'} />
        </div>
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          Failed payments and emails open in Billing and Email log for the detail.
        </p>
      </FounderSection>
    </>
  );
}
