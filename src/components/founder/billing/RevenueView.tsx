'use client';

import { useMemo, useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, ErrorState, LoadingState, Select } from '@/components/ui';
import { useRevenueQuery } from '@/features/founderQueries';
import { summarizeRevenue, type RevenueMonth } from '@/lib/revenue';
import { FounderSection } from '../FounderUi';
import { formatDate, planLabel } from '../labels';
import { errorMessage, formatMoney, formatPercent } from './format';

const PERIOD_OPTIONS = [
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months' },
];

const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function RevenueView() {
  const colors = useThemeColors();
  const [months, setMonths] = useState('12');
  const query = useRevenueQuery(Number(months));
  const summary = useMemo(() => (query.data ? summarizeRevenue(query.data) : null), [query.data]);

  const periodSelect = (
    <Select aria-label="Period" value={months} onChange={(e) => setMonths(e.target.value)} options={PERIOD_OPTIONS} />
  );

  if (query.isLoading) return <LoadingState message="Reading subscriptions and charges from Stripe..." />;
  if (query.isError || !summary || !query.data) {
    return <ErrorState message={errorMessage(query.error, 'Could not load revenue.')} onRetry={() => query.refetch()} />;
  }

  const tiles = [
    { label: 'MRR', value: formatMoney(summary.mrrCents), hint: 'Monthly recurring revenue' },
    { label: 'ARR', value: formatMoney(summary.arrCents), hint: 'MRR × 12' },
    { label: 'Paying subscribers', value: summary.subscribers.toLocaleString(), hint: 'Accounts paying today' },
    { label: 'ARPA', value: formatMoney(summary.arpaCents), hint: 'Average MRR per paying account' },
    {
      label: '30-day churn',
      value: formatPercent(summary.churnRate30d),
      hint: `${summary.churned30d} account${summary.churned30d === 1 ? '' : 's'} stopped paying`,
    },
    {
      label: 'Canceling',
      value: summary.cancelingSubscribers.toLocaleString(),
      hint: `Set to end at period end · ${summary.trialing} on a Stripe trial`,
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          Live from Stripe · updated {formatDate(query.data.generatedAt, true)}
          {query.isFetching ? ' · refreshing…' : ''}
        </p>
        <div className="w-48">{periodSelect}</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label} className="flex flex-col gap-1">
            <p className="text-xs" style={{ color: colors.inkFaint }}>
              {t.label}
            </p>
            <p className="text-lg font-bold tabular-nums" style={{ color: colors.ink }}>
              {t.value}
            </p>
            <p className="text-[11px] leading-tight" style={{ color: colors.inkFaint }}>
              {t.hint}
            </p>
          </Card>
        ))}
      </div>

      <FounderSection title="MRR over time">
        <ColumnChart
          series={summary.series}
          value={(m) => m.mrrCents}
          format={(v) => formatMoney(v)}
          title={(m) => `${monthLabel(m.month)}: ${formatMoney(m.mrrCents)} MRR`}
        />
      </FounderSection>

      <FounderSection title="Paying subscribers">
        <ColumnChart
          series={summary.series}
          value={(m) => m.subscribers}
          format={(v) => v.toLocaleString()}
          title={(m) =>
            `${monthLabel(m.month)}: ${m.subscribers} paying · +${m.newSubscribers} new · −${m.churnedSubscribers} churned`
          }
        />
      </FounderSection>

      <FounderSection title="Month by month">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: colors.inkFaint }}>
                {['Month', 'MRR', 'Paying', 'New', 'Churned', 'Churn', 'Collected', 'Refunded'].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...summary.series].reverse().map((m) => (
                <tr key={m.month} className="border-t tabular-nums" style={{ borderColor: colors.border, color: colors.inkMuted }}>
                  <td className="px-3 py-2 font-semibold" style={{ color: colors.ink }}>
                    {monthLabel(m.month)}
                  </td>
                  <td className="px-3 py-2">{formatMoney(m.mrrCents)}</td>
                  <td className="px-3 py-2">{m.subscribers}</td>
                  <td className="px-3 py-2" style={{ color: m.newSubscribers ? colors.success : undefined }}>
                    {m.newSubscribers ? `+${m.newSubscribers}` : '0'}
                  </td>
                  <td className="px-3 py-2" style={{ color: m.churnedSubscribers ? colors.danger : undefined }}>
                    {m.churnedSubscribers ? `−${m.churnedSubscribers}` : '0'}
                  </td>
                  <td className="px-3 py-2">{formatPercent(m.churnRate)}</td>
                  <td className="px-3 py-2">{formatMoney(m.collectedCents)}</td>
                  <td className="px-3 py-2">{m.refundedCents ? formatMoney(m.refundedCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </FounderSection>

      <FounderSection title="MRR by plan">
        {summary.byTier.length === 0 ? (
          <Card>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Nobody is paying yet.
            </p>
          </Card>
        ) : (
          <Card className="flex flex-col gap-3">
            {summary.byTier.map((t) => (
              <div key={t.tier} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold" style={{ color: colors.ink }}>
                    {t.tier === 'addon' ? 'Add-on team licenses' : planLabel(t.tier)}
                  </span>
                  <span className="tabular-nums" style={{ color: colors.inkMuted }}>
                    <strong style={{ color: colors.ink }}>{formatMoney(t.mrrCents)}</strong> · {t.subscribers} account
                    {t.subscribers === 1 ? '' : 's'} · {formatPercent(summary.mrrCents ? t.mrrCents / summary.mrrCents : null)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${summary.mrrCents ? (t.mrrCents / summary.mrrCents) * 100 : 0}%`,
                      backgroundColor: colors.primary,
                    }}
                  />
                </div>
              </div>
            ))}
          </Card>
        )}
      </FounderSection>

      <p className="text-xs" style={{ color: colors.inkFaint }}>
        MRR spreads yearly plans over 12 months and includes lasting coupons; one-off first-payment discounts and
        loyalty credit don&apos;t lower it. Past months use each subscription&apos;s current price, so a plan change is
        back-dated to when that subscription started. Churn counts accounts, not subscriptions — an upgrade that
        replaces one subscription with another isn&apos;t churn. Comp accounts aren&apos;t billed in Stripe and
        aren&apos;t counted. Collected is successful charges in CAD, including registration fees charged on the platform
        account.
        {summary.otherCurrencySubscriptions
          ? ` ${summary.otherCurrencySubscriptions} non-CAD subscription(s) are left out.`
          : ''}
        {query.data.truncated ? ' Stripe history was too long to read in full; older data may be incomplete.' : ''}
      </p>
    </>
  );
}

function ColumnChart({
  series,
  value,
  format,
  title,
}: {
  series: RevenueMonth[];
  value: (m: RevenueMonth) => number;
  format: (v: number) => string;
  title: (m: RevenueMonth) => string;
}) {
  const colors = useThemeColors();
  const peak = Math.max(0, ...series.map(value));
  const top = Math.max(1, peak);
  const last = series[series.length - 1];

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs" style={{ color: colors.inkFaint }}>
        <span>Peak {format(peak)}</span>
        <span>
          Now <strong style={{ color: colors.ink }}>{last ? format(value(last)) : '—'}</strong>
        </span>
      </div>
      <div className="flex h-36 items-end gap-1" role="img" aria-label={series.map(title).join('; ')}>
        {series.map((m, i) => (
          <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={title(m)}>
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${(value(m) / top) * 100}%`,
                minHeight: value(m) ? 2 : 0,
                backgroundColor: colors.primary,
                opacity: i === series.length - 1 ? 1 : 0.75,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-[10px]" style={{ color: colors.inkFaint }}>
        {series.map((m, i) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center">
            {series.length <= 12 || i % 3 === 0 ? monthLabel(m.month) : ''}
          </span>
        ))}
      </div>
    </Card>
  );
}
