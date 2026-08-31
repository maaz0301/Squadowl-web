'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Modal, PageHeader, useAlert } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useEnterprisePaymentsQuery } from '@/features/queries';
import { useConnectStatus } from '@/features/useConnectStatus';
import { queryKeys } from '@/lib/queryClient';
import { getDataSource } from '@/data';
import { download } from '@/lib/exportData';
import { useUser, useAuthStore } from '@/state/authStore';
import { isTierAtLeast } from '@/data/plans';

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Stripe's Canada (CAD) fee schedule, separate from TryoutHQ's own 0.5%
// platform fee. Verified June 2026 — re-check against Stripe's published
// rates before updating any of these numbers.
const FEE_SCHEDULE: { type: string; fee: string; note: string }[] = [
  { type: 'Domestic card (CAD)', fee: '2.9% + CAD$0.30', note: 'Standard Canadian card — most common transaction.' },
  {
    type: 'International card',
    fee: '2.9% + CAD$0.30 + 0.8%',
    note: 'Card issued outside Canada — total ~3.7% + CAD$0.30.',
  },
  {
    type: 'Currency conversion',
    fee: '+ 2.0% additional',
    note: 'When payment currency differs from payout currency.',
  },
  {
    type: 'Stripe Billing (subscriptions)',
    fee: '+ 0.7% additional',
    note: "Applied when using Stripe's subscription billing system.",
  },
  { type: 'Chargeback / dispute', fee: 'CAD$15 flat fee', note: 'Charged whether you win or lose the dispute.' },
  {
    type: 'Stripe Connect (platform fee)',
    fee: '0.25% + CAD$0.25',
    note: 'Required for collecting the 0.5% TryoutHQ platform fee.',
  },
];

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  const colors = useThemeColors();
  return (
    <Card className="min-w-[104px] flex-1 flex flex-col gap-1">
      <span className="text-2xl font-bold" style={{ color: tone ?? colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {value}
      </span>
      <span className="text-xs font-bold" style={{ color: colors.ink }}>
        {label}
      </span>
      {hint ? (
        <span className="text-[10px]" style={{ color: colors.inkMuted }}>
          {hint}
        </span>
      ) : null}
    </Card>
  );
}

export default function PaymentsPage() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const user = useUser();
  const tier = user?.planTier ?? 'free';
  const paymentsQuery = useEnterprisePaymentsQuery();
  const connect = useConnectStatus();
  const [exporting, setExporting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showFeeDetails, setShowFeeDetails] = useState(false);
  const qc = useQueryClient();
  const restoreSession = useAuthStore((s) => s.restoreSession);

  // Coach gets the basic ledger + totals. Coach+ and Club also get per-player /
  // per-assessment breakdowns and CSV export.
  const enhanced = isTierAtLeast(tier, 'coach_plus');

  const finance = useMemo(() => {
    const rows = paymentsQuery.data ?? [];
    const sum = (status: string) => rows.filter((p) => p.status === status).reduce((s, p) => s + (p.amount || 0), 0);

    const byPlayer = new Map<string, number>();
    const byAssessment = new Map<string, number>();
    for (const p of rows) {
      if (p.status !== 'paid') continue;
      byPlayer.set(p.playerName, (byPlayer.get(p.playerName) ?? 0) + p.amount);
      const assessmentKey = p.assessmentName || 'Unknown Event';
      byAssessment.set(assessmentKey, (byAssessment.get(assessmentKey) ?? 0) + p.amount);
    }

    return {
      rows,
      collected: sum('paid'),
      pending: sum('pending'),
      refunded: sum('refunded'),
      paidCount: rows.filter((p) => p.status === 'paid').length,
      pendingCount: rows.filter((p) => p.status === 'pending').length,
      byPlayer: [...byPlayer.entries()].sort((a, b) => b[1] - a[1]),
      byAssessment: [...byAssessment.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [paymentsQuery.data]);

  const exportCsv = () => {
    const rows = finance.rows;
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const csvRows = rows.map(
        (p) => `${p.playerName},${p.teamName},${p.assessmentName || 'Unknown Event'},${p.amount.toFixed(2)},${p.status}`,
      );
      const csv = `player,team,evaluation,amount,status\n${csvRows.join('\n')}`;
      download('payments.csv', csv, 'utf8', 'text/csv');
    } finally {
      setExporting(false);
    }
  };

  const connectPayouts = async () => {
    try {
      setConnecting(true);
      const res = await getDataSource().createConnectAccountLink();
      if (!res?.url) return;

      // Opened in a new tab rather than a full-page redirect: Stripe's
      // account-link return_url is connect-return, a shared backend function
      // that always finishes by deep-linking to aastryout://payments for the
      // mobile app — on a desktop browser that's a dead end with no way back
      // here. Keeping this tab alive lets the poll below pick up the change
      // once onboarding finishes in the other tab.
      window.open(res.url, '_blank', 'noopener,noreferrer');

      // Stripe's account.updated webhook lands a moment after onboarding
      // finishes, so poll a few times instead of assuming it's instant. The
      // connect-status refetch is what actually settles this — it reads Stripe
      // directly and heals the cached column — so the loop waits on that rather
      // than on the profile flag, which never moves at all when the Connect
      // webhook is misconfigured.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data: live } = await connect.refetch();
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        const current = useAuthStore.getState().session?.user;
        if (live?.chargesEnabled || current?.connectChargesEnabled) break;
      }
    } catch (err) {
      await alert('Connect Error', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Payments" showBack backHref="/profile" />
      <PlanGate feature="payments" title="Payment Dashboard">
        <>
          {!connect.chargesEnabled ? (
            <Card accent className="mb-4 flex flex-col gap-2">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                Connect Payouts
              </span>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Connect a Stripe account to start collecting registration fees. Stripe&apos;s processing fee (2.9% +
                $0.30 CAD) and TryoutHQ&apos;s 0.5% platform fee are deducted automatically — the rest is paid out
                straight to you.
              </span>
              {connect.onboardingIncomplete ? (
                <span className="text-xs" style={{ color: colors.warning }}>
                  Your Stripe account isn&apos;t finished — Stripe still needs more information before it will accept
                  charges. Continue where you left off below.
                </span>
              ) : null}
              <Button
                label={connect.onboardingIncomplete ? 'Continue Stripe Setup' : 'Connect with Stripe'}
                loading={connecting}
                onClick={connectPayouts}
              />
              <Button label="View Fee Details" variant="ghost" size="sm" onClick={() => setShowFeeDetails(true)} />
            </Card>
          ) : (
            <Card className="mb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge label="Payouts connected" variant="success" />
                <Button label="Fee Details" variant="ghost" size="sm" onClick={() => setShowFeeDetails(true)} />
              </div>
              {connect.isLoading ? (
                <span className="text-xs" style={{ color: colors.inkMuted }}>
                  Loading connected account…
                </span>
              ) : connect.status?.connected ? (
                <>
                  <span className="text-sm font-bold" style={{ color: colors.ink }}>
                    {connect.status.businessName || connect.status.email || connect.status.accountId}
                  </span>
                  <span className="text-xs" style={{ color: colors.inkMuted }}>
                    Stripe account {connect.status.accountId}
                    {connect.status.country ? ` · ${connect.status.country}` : ''} ·{' '}
                    {(connect.status.platformFeeRate * 100).toFixed(1)}% TryoutHQ fee + Stripe&apos;s processing fee
                    per transaction
                  </span>
                </>
              ) : (
                <span className="text-xs" style={{ color: colors.warning }}>
                  Couldn&apos;t load connected account details.
                </span>
              )}
            </Card>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            <Stat label="Collected" value={money(finance.collected)} hint={`${finance.paidCount} payments`} tone={colors.success} />
            <Stat label="Pending" value={money(finance.pending)} hint={`${finance.pendingCount} outstanding`} tone={colors.warning} />
            <Stat label="Refunded" value={money(finance.refunded)} tone={colors.danger} />
          </div>

          {enhanced ? (
            <>
              <p className="mb-3 text-base font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                By Player
              </p>
              {finance.byPlayer.length === 0 ? (
                <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
                  No paid payments yet.
                </p>
              ) : (
                finance.byPlayer.map(([name, amount]) => (
                  <Card key={name} className="mb-2 flex justify-between">
                    <span style={{ color: colors.ink }}>{name}</span>
                    <span className="font-bold" style={{ color: colors.ink }}>
                      {money(amount)}
                    </span>
                  </Card>
                ))
              )}

              <p className="mb-3 mt-2 text-base font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                By Evaluation
              </p>
              {finance.byAssessment.length === 0 ? (
                <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
                  No paid payments yet.
                </p>
              ) : (
                finance.byAssessment.map(([name, amount]) => (
                  <Card key={name} className="mb-2 flex justify-between">
                    <span style={{ color: colors.ink }}>{name}</span>
                    <span className="font-bold" style={{ color: colors.ink }}>
                      {money(amount)}
                    </span>
                  </Card>
                ))
              )}

              <Button label="Export CSV" variant="secondary" className="mb-4" loading={exporting} onClick={exportCsv} />
            </>
          ) : null}

          <p className="mb-3 text-base font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Payment Ledger
          </p>
          {finance.rows.length === 0 ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              No payments recorded yet.
            </p>
          ) : (
            finance.rows.map((item) => (
              <Card key={item.id} className="mb-2 flex items-center justify-between">
                <div className="flex-1 pr-2">
                  <p className="font-bold" style={{ color: colors.ink }}>
                    {item.playerName}
                  </p>
                  <p className="text-sm" style={{ color: colors.inkMuted }}>
                    {[item.teamName, item.assessmentName].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                    {money(item.amount)}
                  </span>
                  <Badge
                    label={item.status}
                    variant={item.status === 'paid' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'}
                  />
                </div>
              </Card>
            ))
          )}
        </>
      </PlanGate>

      <Modal visible={showFeeDetails} title="Stripe & Platform Fees" onClose={() => setShowFeeDetails(false)}>
        <>
          <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
            These are Stripe&apos;s own processing fees (CAD), deducted automatically per transaction before funds
            reach your account — separate from TryoutHQ&apos;s 0.5% platform fee. Verified June 2026.
          </p>

          {FEE_SCHEDULE.map((row) => (
            <div key={row.type} className="mb-4 border-b pb-4" style={{ borderColor: colors.border }}>
              <p className="font-bold" style={{ color: colors.ink }}>
                {row.type}
              </p>
              <p className="mt-0.5 font-bold" style={{ color: colors.primary }}>
                {row.fee}
              </p>
              <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
                {row.note}
              </p>
            </div>
          ))}

          <p className="mb-3 mt-2 font-bold" style={{ color: colors.ink }}>
            Real example — CAD$100 registration fee
          </p>
          <div className="mb-3 flex flex-col gap-2">
            <div className="flex justify-between gap-2">
              <span className="flex-1 text-sm" style={{ color: colors.inkMuted }}>
                Stripe fee (2.9% + $0.30)
              </span>
              <span className="text-sm" style={{ color: colors.ink }}>
                −$3.20
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="flex-1 text-sm" style={{ color: colors.inkMuted }}>
                TryoutHQ platform fee (0.5%)
              </span>
              <span className="text-sm" style={{ color: colors.ink }}>
                −$0.50
              </span>
            </div>
            <div className="mt-1 flex justify-between gap-2">
              <span className="flex-1 font-bold" style={{ color: colors.ink }}>
                Coach receives
              </span>
              <span className="font-bold" style={{ color: colors.success }}>
                $96.30
              </span>
            </div>
          </div>
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Stripe fees are paid by the coach (subscriber), not by TryoutHQ.
          </p>
        </>
      </Modal>
    </div>
  );
}
