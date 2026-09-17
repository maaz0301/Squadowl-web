'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui';
import { FounderNotAvailable, FounderSection } from '@/components/founder/FounderUi';
import { formatDate } from '@/components/founder/labels';
import type { FounderFunnel, FounderReferral } from '@/data/founder/types';
import {
  useFeatureAccountsQuery,
  useFeatureUsageQuery,
  useFounderFunnelQuery,
  useFounderReferralBalancesQuery,
  useFounderReferralsQuery,
  useIsFounderQuery,
} from '@/features/founderQueries';
import { FEATURES, featureLabel } from '@/lib/analytics';

/**
 * The founder console's own pages, for the "What's tracked?" modal only —
 * these never appear in FEATURES and never get a row in
 * analytics_feature_usage: track_feature_use() skips platform admins, and
 * AppShell doesn't even call it for the founder or while viewing as someone
 * (see trackedFeature there). Listed here purely so the modal can say why,
 * instead of just going quiet about them. Kept in sync with AppShell's own
 * founder nav items by hand — there's no shared source for either list.
 */
const FOUNDER_ROUTES = [
  { href: '/founder', label: 'Founder Console' },
  { href: '/founder/analytics', label: 'Analytics' },
  { href: '/founder/billing', label: 'Billing & Revenue' },
  { href: '/founder/users', label: 'Users' },
  { href: '/founder/support', label: 'Support Inbox' },
  { href: '/founder/announcements', label: 'Announcements' },
  { href: '/founder/email-log', label: 'Email Log' },
];

const VIEW_TABS = [
  { key: 'funnel', label: 'Sign-up Funnel' },
  { key: 'features', label: 'Feature Usage' },
  { key: 'referrals', label: 'Referrals' },
];

const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const money = (cents: number) => cad.format(cents / 100);

function percent(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function FounderAnalyticsPage() {
  const founderQuery = useIsFounderQuery();
  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  return <Analytics />;
}

function Analytics() {
  const [view, setView] = useState('funnel');
  const [days, setDays] = useState('30');

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Sign-ups, feature adoption and referrals across TryoutHQ"
        right={
          view === 'referrals' ? undefined : (
            <Select
              aria-label="Period"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              options={PERIOD_OPTIONS}
            />
          )
        }
      />
      <Tabs tabs={VIEW_TABS} activeKey={view} onChange={setView} className="mb-4" />
      {view === 'funnel' ? <FunnelView days={Number(days)} /> : null}
      {view === 'features' ? <FeaturesView days={Number(days)} /> : null}
      {view === 'referrals' ? <ReferralsView /> : null}
    </>
  );
}

// ─── Funnel ──────────────────────────────────────────────────────────────────

function FunnelView({ days }: { days: number }) {
  const colors = useThemeColors();
  const query = useFounderFunnelQuery(days);

  if (query.isLoading) return <LoadingState message="Loading funnel..." />;
  if (query.isError || !query.data) {
    return (
      <ErrorState message={errorMessage(query.error, 'Could not load the funnel.')} onRetry={() => query.refetch()} />
    );
  }

  const { totals, series, sources } = query.data;
  const stages = [
    { label: 'Visitors', value: totals.visitors, hint: 'Unique visitors to sign-in / sign-up' },
    { label: 'Sign-ups', value: totals.signups, hint: 'New organizations created' },
    { label: 'Trials', value: totals.trials, hint: 'Of those sign-ups, started a trial' },
    { label: 'Paid', value: totals.paid, hint: 'Of those sign-ups, now paying' },
  ];
  const top = Math.max(1, ...stages.map((s) => s.value));
  const periodStart = series[0]?.day;
  const visitsPartial = !!totals.firstVisitDay && !!periodStart && totals.firstVisitDay > periodStart;

  return (
    <>
      {visitsPartial || !totals.firstVisitDay ? (
        <p className="mb-3 text-xs" style={{ color: colors.inkFaint }}>
          {totals.firstVisitDay
            ? `Visit tracking started ${formatDate(Date.parse(totals.firstVisitDay))} — visitors before then weren't recorded.`
            : 'No visits recorded yet — visitor counts start once this version is deployed.'}
        </p>
      ) : null}

      <FounderSection title="Funnel">
        <Card className="flex flex-col gap-4">
          {stages.map((stage, i) => (
            <div key={stage.label} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold" style={{ color: colors.ink }}>
                  {stage.label}{' '}
                  <span className="text-xs font-normal" style={{ color: colors.inkFaint }}>
                    {stage.hint}
                  </span>
                </p>
                <p className="text-sm tabular-nums" style={{ color: colors.inkMuted }}>
                  <strong style={{ color: colors.ink }}>{stage.value.toLocaleString()}</strong>
                  {i > 0 ? ` · ${percent(stage.value, stages[i === 1 ? 0 : 1].value)}` : ''}
                </p>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(stage.value ? 2 : 0, (stage.value / top) * 100)}%`,
                    backgroundColor: colors.primary,
                    opacity: 1 - i * 0.18,
                  }}
                />
              </div>
            </div>
          ))}
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            Trial and paid rates are of sign-ups. In this period, regardless of when the account was created:{' '}
            {totals.trialsStarted} trial{totals.trialsStarted === 1 ? '' : 's'} started ·{' '}
            {totals.paidStarted} first payment{totals.paidStarted === 1 ? '' : 's'}.
          </p>
        </Card>
      </FounderSection>

      <FounderSection title="Daily sign-ups">
        <DailyChart funnel={query.data} />
      </FounderSection>

      <FounderSection title="Where visitors came from">
        {sources.length === 0 ? (
          <Card>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              No visits in this period.
            </p>
          </Card>
        ) : (
          <Card className="flex flex-col gap-2">
            {sources.map((s) => (
              <div key={s.source} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 break-all" style={{ color: colors.ink }}>
                  {s.source}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: colors.inkMuted }}>
                  {s.visitors.toLocaleString()} · {percent(s.visitors, totals.visitors)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </FounderSection>
    </>
  );
}

/** Sign-ups per day as columns; paid conversions on the same day are the darker cap. */
function DailyChart({ funnel }: { funnel: FounderFunnel }) {
  const colors = useThemeColors();
  const series = funnel.series;
  const top = Math.max(1, ...series.map((d) => d.signups));
  const total = series.reduce((sum, d) => sum + d.signups, 0);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex h-32 items-end gap-px" role="img" aria-label={`${total} sign-ups over ${funnel.days} days`}>
        {series.map((d) => (
          <div
            key={d.day}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${formatDate(Date.parse(d.day))}: ${d.visitors} visitors, ${d.signups} sign-ups, ${d.trials} trials, ${d.paid} paid`}
          >
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${(d.signups / top) * 100}%`,
                minHeight: d.signups ? 2 : 0,
                backgroundColor: colors.primary,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs" style={{ color: colors.inkFaint }}>
        <span>{series[0] ? formatDate(Date.parse(series[0].day)) : ''}</span>
        <span>
          {total} sign-up{total === 1 ? '' : 's'} · peak {top === 1 && total === 0 ? 0 : top}/day
        </span>
        <span>{series.length ? formatDate(Date.parse(series[series.length - 1].day)) : ''}</span>
      </div>
    </Card>
  );
}

// ─── Feature usage ───────────────────────────────────────────────────────────

function FeaturesView({ days }: { days: number }) {
  const colors = useThemeColors();
  const query = useFeatureUsageQuery(days);
  const [open, setOpen] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Rendered ahead of every branch below (loading, error, empty, populated) —
  // it's a static reference to the catalog, not something the query result
  // should gate.
  const header = (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
      <p className="text-xs" style={{ color: colors.inkFaint }}>
        People who opened each feature in the period. Tap a feature to see which organizations use it.
      </p>
      <button
        type="button"
        onClick={() => setShowInfo(true)}
        className="shrink-0 text-xs font-bold underline-offset-2 hover:underline"
        style={{ color: colors.primary }}
      >
        What&apos;s tracked?
      </button>
      <FeaturesInfoModal visible={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  );

  if (query.isLoading) {
    return (
      <>
        {header}
        <LoadingState message="Loading feature usage..." />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {header}
        <ErrorState
          message={errorMessage(query.error, 'Could not load feature usage.')}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }
  const rows = query.data ?? [];
  if (!rows.length) {
    return (
      <>
        {header}
        <EmptyState
          title="No feature usage yet"
          message="Usage is recorded when a customer opens a feature's screen, from this version on."
        />
      </>
    );
  }
  const top = Math.max(1, ...rows.map((r) => r.users));

  return (
    <>
      {header}
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <Card key={r.feature} className="flex flex-col gap-2">
            <button
              type="button"
              className="flex flex-col gap-1.5 text-left"
              aria-expanded={open === r.feature}
              onClick={() => setOpen((cur) => (cur === r.feature ? null : r.feature))}
            >
              <div className="flex w-full flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold" style={{ color: colors.ink }}>
                  {featureLabel(r.feature)}
                </p>
                <p className="text-sm tabular-nums" style={{ color: colors.inkMuted }}>
                  <strong style={{ color: colors.ink }}>{r.users}</strong> user{r.users === 1 ? '' : 's'} ·{' '}
                  {r.accounts} org{r.accounts === 1 ? '' : 's'} · {r.uses} open{r.uses === 1 ? '' : 's'}
                </p>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(r.users / top) * 100}%`, backgroundColor: colors.primary }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {r.lastUsedAt ? (
                  <span style={{ color: colors.inkFaint }}>Last used {formatDate(r.lastUsedAt, true)} ·</span>
                ) : null}
                <span className="inline-flex items-center gap-1 font-bold" style={{ color: colors.primary }}>
                  {open === r.feature ? 'Hide organizations' : 'Who is using it'}
                  <svg
                    width={12}
                    height={12}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform"
                    style={{ transform: open === r.feature ? 'rotate(180deg)' : undefined }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
            </button>
            {open === r.feature ? <FeatureAccounts feature={r.feature} days={days} /> : null}
          </Card>
        ))}
      </div>
    </>
  );
}

function FeatureAccounts({ feature, days }: { feature: string; days: number }) {
  const colors = useThemeColors();
  const query = useFeatureAccountsQuery(feature, days);

  if (query.isLoading) return <Spinner />;
  if (query.isError) {
    return (
      <p className="text-sm" style={{ color: colors.danger }}>
        {errorMessage(query.error, 'Could not load organizations.')}
      </p>
    );
  }
  const accounts = query.data ?? [];
  if (!accounts.length) return <p className="text-sm">Nobody in this period.</p>;

  return (
    <ul className="flex flex-col gap-2 border-t pt-2" style={{ borderColor: colors.border }}>
      {accounts.map((a) => (
        <li key={a.accountId ?? 'none'} className="flex flex-col gap-0.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {a.accountId ? (
              <Link
                href={`/founder/organizations/${a.accountId}`}
                className="font-semibold underline-offset-2 hover:underline"
                style={{ color: colors.ink }}
              >
                {a.accountName ?? 'Unnamed organization'}
              </Link>
            ) : (
              <span className="font-semibold" style={{ color: colors.ink }}>
                No organization (guardians)
              </span>
            )}
            <span className="tabular-nums" style={{ color: colors.inkMuted }}>
              {a.uses} open{a.uses === 1 ? '' : 's'} · {a.activeDays} day{a.activeDays === 1 ? '' : 's'}
              {a.lastUsedAt ? ` · ${formatDate(a.lastUsedAt)}` : ''}
            </span>
          </div>
          <p className="break-all text-xs" style={{ color: colors.inkFaint }}>
            {a.users.map((u) => u.name ? `${u.name} (${u.email})` : u.email).join(', ')}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * What Feature Usage actually measures, for a founder wondering why a screen
 * they know is popular isn't showing up (or shows zero on web/mobile).
 * Grouped from FEATURES itself, so this never drifts from what
 * featureForPath() really matches — see src/lib/analytics.ts.
 */
function FeaturesInfoModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useThemeColors();
  const areas = [...new Set(FEATURES.map((f) => f.area))];

  return (
    <Modal visible={visible} title="What's tracked?" onClose={onClose} size="lg">
      <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
        A visit counts the moment a signed-in customer opens one of these screens on the{' '}
        <strong style={{ color: colors.ink }}>web app</strong>. Hub pages — Dashboard, a team&apos;s own page,
        an assessment&apos;s Roster tab — aren&apos;t tracked; only the tools reached from them are.
      </p>

      {areas.map((area) => (
        <div key={area} className="mb-4">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em]" style={{ color: colors.inkFaint }}>
            {area}
          </h3>
          <ul className="flex flex-col gap-1">
            {FEATURES.filter((f) => f.area === area).map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-2 text-sm">
                <span style={{ color: colors.ink }}>{f.label}</span>
                <Badge label="Web" variant="info" size="sm" />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mb-4">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em]" style={{ color: colors.inkFaint }}>
          Founder console
        </h3>
        <p className="mb-1.5 text-xs" style={{ color: colors.inkFaint }}>
          Never tracked, on purpose — a platform admin&apos;s own clicking around shouldn&apos;t count as
          customer usage.
        </p>
        <ul className="flex flex-col gap-1">
          {FOUNDER_ROUTES.map((r) => (
            <li key={r.href} className="flex items-center justify-between gap-2 text-sm">
              <span style={{ color: colors.ink }}>{r.label}</span>
              <Badge label="Excluded" size="sm" />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em]" style={{ color: colors.inkFaint }}>
          Mobile app
        </h3>
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          Not wired up yet — the mobile app has no equivalent of this tracking, so every feature above shows
          web usage only.
        </p>
      </div>
    </Modal>
  );
}

// ─── Referrals ───────────────────────────────────────────────────────────────

function referralStatus(r: FounderReferral): { label: string; variant: 'success' | 'info' | 'warning' | 'default' } {
  if (r.creditCents) return { label: `Paid · earned ${money(r.creditCents)}`, variant: 'success' };
  if (r.firstPaidAt) return { label: 'Paid · no credit (annual cap)', variant: 'warning' };
  if (r.subscriptionStatus === 'trialing') return { label: 'Trial', variant: 'info' };
  return { label: 'Signed up', variant: 'default' };
}

function ReferralsView() {
  const colors = useThemeColors();
  const referralsQuery = useFounderReferralsQuery();
  const balancesQuery = useFounderReferralBalancesQuery();
  const [balanceFilter, setBalanceFilter] = useState('owed');

  if (referralsQuery.isLoading || balancesQuery.isLoading) return <LoadingState message="Loading referrals..." />;
  const failed = referralsQuery.error ?? balancesQuery.error;
  if (failed) {
    return (
      <ErrorState
        message={errorMessage(failed, 'Could not load referrals.')}
        onRetry={() => {
          void referralsQuery.refetch();
          void balancesQuery.refetch();
        }}
      />
    );
  }

  const referrals = referralsQuery.data ?? [];
  const balances = balancesQuery.data ?? [];
  const earned = balances.reduce((s, b) => s + b.earnedCents, 0);
  const redeemed = balances.reduce((s, b) => s + b.redeemedCents, 0);
  const owed = balances.reduce((s, b) => s + Math.max(0, b.balanceCents), 0);
  const converted = referrals.filter((r) => r.firstPaidAt).length;
  const shownBalances = balanceFilter === 'owed' ? balances.filter((b) => b.balanceCents > 0) : balances;

  const tiles = [
    { label: 'Referred sign-ups', value: referrals.length.toLocaleString() },
    { label: 'Converted to paid', value: `${converted} · ${percent(converted, referrals.length)}` },
    { label: 'Credit earned', value: money(earned) },
    { label: 'Credit redeemed', value: money(redeemed) },
    { label: 'Credit owed', value: money(owed) },
  ];

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label} className="flex flex-col gap-1">
            <p className="text-xs" style={{ color: colors.inkFaint }}>
              {t.label}
            </p>
            <p className="text-lg font-bold tabular-nums" style={{ color: colors.ink }}>
              {t.value}
            </p>
          </Card>
        ))}
      </div>

      <FounderSection title="Credits owed">
        <Tabs
          tabs={[
            { key: 'owed', label: 'With a balance' },
            { key: 'all', label: 'All referrers' },
          ]}
          activeKey={balanceFilter}
          onChange={setBalanceFilter}
        />
        {shownBalances.length === 0 ? (
          <Card>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              {balanceFilter === 'owed' ? 'No account is holding unspent credit.' : 'Nobody has referred anyone yet.'}
            </p>
          </Card>
        ) : (
          shownBalances.map((b) => (
            <Card key={b.accountId} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/founder/organizations/${b.accountId}`}
                  className="font-semibold underline-offset-2 hover:underline"
                  style={{ color: colors.ink }}
                >
                  {b.accountName}
                </Link>
                <p className="break-all text-xs" style={{ color: colors.inkFaint }}>
                  {[b.ownerEmail, b.referralCode ? `code ${b.referralCode}` : null].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  {b.referredCount} referred · {b.paidCount} paid · earned {money(b.earnedCents)} · redeemed{' '}
                  {money(b.redeemedCents)}
                  {b.adjustedCents ? ` · adjusted ${money(b.adjustedCents)}` : ''} · {money(b.earnedLastYearCents)} of{' '}
                  {money(6000)} yearly cap
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs" style={{ color: colors.inkFaint }}>
                  Owed
                </p>
                <p
                  className="text-lg font-bold tabular-nums"
                  style={{ color: b.balanceCents > 0 ? colors.success : colors.inkMuted }}
                >
                  {money(Math.max(0, b.balanceCents))}
                </p>
              </div>
            </Card>
          ))
        )}
      </FounderSection>

      <FounderSection title="Who referred whom">
        {referrals.length === 0 ? (
          <Card>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              No sign-ups have used a referral code yet.
            </p>
          </Card>
        ) : (
          referrals.map((r) => {
            const status = referralStatus(r);
            return (
              <Card key={r.referredAccountId} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm" style={{ color: colors.inkMuted }}>
                    <Link
                      href={`/founder/organizations/${r.referrerAccountId}`}
                      className="font-semibold underline-offset-2 hover:underline"
                      style={{ color: colors.ink }}
                    >
                      {r.referrerName}
                    </Link>{' '}
                    referred{' '}
                    <Link
                      href={`/founder/organizations/${r.referredAccountId}`}
                      className="font-semibold underline-offset-2 hover:underline"
                      style={{ color: colors.ink }}
                    >
                      {r.referredName}
                    </Link>
                  </p>
                  <Badge label={status.label} variant={status.variant} />
                </div>
                <p className="break-all text-xs" style={{ color: colors.inkFaint }}>
                  {r.referrerOwnerEmail ?? '—'} → {r.referredOwnerEmail ?? '—'}
                  {r.referrerCode ? ` · code ${r.referrerCode}` : ''}
                </p>
                <p className="text-xs" style={{ color: colors.inkFaint }}>
                  Signed up {formatDate(r.attributedAt ?? r.referredCreatedAt)}
                  {r.firstPaidAt ? ` · paid ${formatDate(r.firstPaidAt)}` : ''}
                  {r.creditedAt ? ` · credited ${formatDate(r.creditedAt)}` : ''}
                </p>
              </Card>
            );
          })
        )}
      </FounderSection>
    </>
  );
}
