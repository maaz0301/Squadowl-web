'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Select,
  Spinner,
  Tabs,
  useAlert,
} from '@/components/ui';
import type {
  BillingFilter,
  FounderAccessKind,
  FounderSubscriptionAccount,
  PaidPlanTier,
  StripeSubscription,
} from '@/data/founder/types';
import { PLAN_TIERS } from '@/data/types';
import {
  useCancelStripeSubscriptionMutation,
  useChangeStripePlanMutation,
  useFounderSubscriptionsQuery,
  useInvalidateBilling,
  useResumeStripeSubscriptionMutation,
  useAddAccountCreditMutation,
  useSetBillingDateMutation,
  useStripeSubscriptionsQuery,
  useSubscriptionCountsQuery,
  useUpdateOrganizationAccessMutation,
} from '@/features/founderQueries';
import { daysUntil } from '@/lib/accountAccess';
import { useDebouncedValue } from '@/lib/hooks';
import { FounderSection } from '../FounderUi';
import { PLAN_OPTIONS, STATUS_BADGE, formatDate, planLabel } from '../labels';
import { errorMessage, formatMoney, subscriptionStatusBadge } from './format';

const PAGE_SIZE = 25;

const BILLING_TABS: { key: BillingFilter | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Paying' },
  { key: 'comp', label: 'Comp' },
  { key: 'trial', label: 'Trial' },
  { key: 'free', label: 'Free' },
  { key: 'past_due', label: 'Past due' },
  { key: 'canceling', label: 'Canceling' },
];

const TIER_FILTER = [{ value: '', label: 'All plans' }, ...PLAN_OPTIONS];

const LIVE = ['active', 'trialing', 'past_due'];

export function SubscriptionsView({ onViewPayments }: { onViewPayments: (account: { id: string; name: string }) => void }) {
  const colors = useThemeColors();
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [billing, setBilling] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [managing, setManaging] = useState<FounderSubscriptionAccount | null>(null);
  const debounced = useDebouncedValue(search.trim(), 300);

  const counts = useSubscriptionCountsQuery();
  const query = useFounderSubscriptionsQuery({
    search: debounced || undefined,
    tier: tier || undefined,
    billing: billing === 'all' ? undefined : (billing as BillingFilter),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tierCounts = PLAN_TIERS.map((t) => {
    const c = counts.data?.find((row) => row.planTier === t);
    return { tier: t, accounts: c?.accounts ?? 0, paying: c?.paying ?? 0, comp: c?.comp ?? 0, trial: c?.trial ?? 0 };
  });

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tierCounts.map((t) => (
          <button
            key={t.tier}
            type="button"
            className="text-left transition hover:brightness-110"
            onClick={() => {
              setTier((cur) => (cur === t.tier ? '' : t.tier));
              setPage(0);
            }}
          >
            <Card accent={tier === t.tier} className="flex flex-col gap-1">
              <p className="text-xs" style={{ color: colors.inkFaint }}>
                {planLabel(t.tier)}
              </p>
              <p className="text-lg font-bold tabular-nums" style={{ color: colors.ink }}>
                {counts.isLoading ? '…' : t.accounts.toLocaleString()}
              </p>
              <p className="text-[11px]" style={{ color: colors.inkFaint }}>
                {t.tier === 'free' ? `${t.trial} on trial` : `${t.paying} paying · ${t.comp} comp · ${t.trial} trial`}
              </p>
            </Card>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search name, owner email or cus_ id"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          containerClassName="flex-1"
        />
        <Select
          aria-label="Plan"
          value={tier}
          onChange={(e) => {
            setTier(e.target.value);
            setPage(0);
          }}
          options={TIER_FILTER}
          containerClassName="sm:w-48"
        />
      </div>
      <Tabs
        tabs={BILLING_TABS}
        activeKey={billing}
        onChange={(k) => {
          setBilling(k);
          setPage(0);
        }}
        className="mb-4"
      />

      {query.isLoading ? (
        <LoadingState message="Loading subscriptions..." />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, 'Could not load subscriptions.')} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No accounts" message="Nothing matches those filters." />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/founder/organizations/${a.id}`}
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: colors.ink }}
                  >
                    {a.name}
                  </Link>
                  <Badge label={planLabel(a.planTier)} variant="brand" />
                  {a.subscriptionStatus !== 'none' ? (
                    <Badge
                      label={subscriptionStatusBadge(a.subscriptionStatus).label}
                      variant={subscriptionStatusBadge(a.subscriptionStatus).variant}
                    />
                  ) : null}
                  {a.isComp ? <Badge label="Comp" variant="info" /> : null}
                  {a.accessStatus !== 'active' ? (
                    <Badge label={STATUS_BADGE[a.accessStatus].label} variant={STATUS_BADGE[a.accessStatus].variant} />
                  ) : null}
                </div>
                <p className="truncate text-sm" style={{ color: colors.inkMuted }}>
                  {a.ownerEmail ?? 'No owner'}
                </p>
                <p className="text-xs" style={{ color: colors.inkFaint }}>
                  {[
                    a.firstPaidAt ? `Paying since ${formatDate(a.firstPaidAt)}` : null,
                    a.trialEndsAt ? `Trial ends ${formatDate(a.trialEndsAt)}` : null,
                    a.subscriptionCancelAt ? `Cancels ${formatDate(a.subscriptionCancelAt)}` : null,
                    a.pendingPlanTier && a.pendingPlanChangeAt
                      ? `Moves to ${planLabel(a.pendingPlanTier)} ${formatDate(a.pendingPlanChangeAt)}`
                      : null,
                    a.extraTeamLicenses ? `+${a.extraTeamLicenses} team licenses` : null,
                    `Joined ${formatDate(a.createdAt)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {a.stripeCustomerId ? (
                  <Button label="Payments" size="sm" variant="ghost" onClick={() => onViewPayments({ id: a.id, name: a.name })} />
                ) : null}
                <Button label="Manage" size="sm" variant="secondary" onClick={() => setManaging(a)} />
              </div>
            </Card>
          ))}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-2 pt-2 text-sm" style={{ color: colors.inkMuted }}>
              <Button label="Previous" size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)} />
              <span>
                Page {page + 1} of {pageCount} · {total} accounts
              </span>
              <Button
                label="Next"
                size="sm"
                variant="ghost"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              />
            </div>
          ) : null}
        </div>
      )}

      {managing ? <ManageSubscriptionModal key={managing.id} account={managing} onClose={() => setManaging(null)} /> : null}
    </>
  );
}

// ─── Manage ─────────────────────────────────────────────────────────────────

const PAID_TIER_OPTIONS = PLAN_OPTIONS.filter((o) => o.value !== 'free');

function ManageSubscriptionModal({ account, onClose }: { account: FounderSubscriptionAccount; onClose: () => void }) {
  const colors = useThemeColors();
  const stripeQuery = useStripeSubscriptionsQuery(account.stripeCustomerId ? account.id : null);
  const subs = stripeQuery.data?.subscriptions ?? [];
  const live = subs.filter((s) => LIVE.includes(s.status));
  const ended = subs.filter((s) => !LIVE.includes(s.status));
  const [showEnded, setShowEnded] = useState(false);

  return (
    <Modal
      visible
      title={account.name}
      size="lg"
      onClose={onClose}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Done" variant="ghost" onClick={onClose} />
        </ModalFooter>
      }
    >
      <FounderSection title="Stripe subscriptions">
        {!account.stripeCustomerId ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Never billed through Stripe. Use the manual plan below to upgrade or comp this account without charging.
          </p>
        ) : stripeQuery.isLoading ? (
          <Spinner />
        ) : stripeQuery.isError ? (
          <p className="text-sm" style={{ color: colors.danger }}>
            {errorMessage(stripeQuery.error, 'Could not load Stripe subscriptions.')}
          </p>
        ) : (
          <>
            {live.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                No live subscription.
              </p>
            ) : (
              live.map((s) => <StripeSubscriptionCard key={s.id} accountId={account.id} sub={s} />)
            )}
            {ended.length ? (
              <button
                type="button"
                className="self-start text-xs underline-offset-2 hover:underline"
                style={{ color: colors.inkFaint }}
                onClick={() => setShowEnded((v) => !v)}
              >
                {showEnded ? 'Hide' : 'Show'} {ended.length} ended subscription{ended.length === 1 ? '' : 's'}
              </button>
            ) : null}
            {showEnded ? ended.map((s) => <StripeSubscriptionCard key={s.id} accountId={account.id} sub={s} />) : null}
          </>
        )}
      </FounderSection>

      {account.stripeCustomerId && !stripeQuery.isLoading && !stripeQuery.isError ? (
        <CreditSection accountId={account.id} balanceCents={stripeQuery.data?.balanceCents ?? 0} />
      ) : null}

      <ManualAccessSection account={account} hasLiveStripe={live.some((s) => s.kind === 'plan')} />
    </Modal>
  );
}

function StripeSubscriptionCard({ accountId, sub }: { accountId: string; sub: StripeSubscription }) {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const changePlan = useChangeStripePlanMutation();
  const cancel = useCancelStripeSubscriptionMutation();
  const resume = useResumeStripeSubscriptionMutation();
  const [newTier, setNewTier] = useState<string>(sub.tier ?? 'club');
  const [prorate, setProrate] = useState(false);
  const setBillingDate = useSetBillingDateMutation();
  const [billingDate, setBillingDateValue] = useState('');
  const isLive = LIVE.includes(sub.status);
  const badge = subscriptionStatusBadge(sub.status);

  const run = async (label: string, fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast(success, 'success');
    } catch (e) {
      await alert(`Could Not ${label}`, errorMessage(e));
    }
  };

  const onChangePlan = async () => {
    if (newTier === sub.tier) return;
    const ok = await confirm({
      title: 'Change Stripe Plan',
      message:
        `Move this subscription from ${planLabel(sub.tier ?? undefined)} to ${planLabel(newTier)}?\n\n` +
        (prorate
          ? 'Stripe will prorate the difference onto the next invoice.'
          : 'Nothing is charged or credited now; the new price applies from the next renewal.') +
        ' The account’s plan updates as soon as Stripe confirms.',
      confirmLabel: 'Change Plan',
    });
    if (!ok) return;
    await run(
      'Change Plan',
      () => changePlan.mutateAsync({ accountId, subscriptionId: sub.id, tier: newTier as PaidPlanTier, prorate }),
      `Subscription moved to ${planLabel(newTier)}.`,
    );
  };

  const onCancel = async (when: 'period_end' | 'now') => {
    const ok = await confirm({
      title: when === 'now' ? 'Cancel Immediately' : 'Cancel at Period End',
      message:
        when === 'now'
          ? 'The subscription ends right now with no refund, and the account drops to its next best plan (usually Free). Refund the last payment separately from Payments if needed.'
          : `The customer keeps their plan until ${sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : 'the end of the period'}, then it ends. You can resume it until then.`,
      confirmLabel: when === 'now' ? 'Cancel Now' : 'Cancel at Period End',
      destructive: true,
    });
    if (!ok) return;
    await run(
      'Cancel',
      () => cancel.mutateAsync({ accountId, subscriptionId: sub.id, when }),
      when === 'now' ? 'Subscription cancelled.' : 'Subscription will cancel at period end.',
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3" style={{ borderColor: colors.border }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold" style={{ color: colors.ink }}>
              {sub.kind === 'plan' ? planLabel(sub.tier ?? undefined) : 'Add-on team licenses'}
            </span>
            <Badge label={badge.label} variant={badge.variant} />
            {sub.cancelAtPeriodEnd ? <Badge label="Canceling" variant="warning" /> : null}
          </div>
          <p className="text-sm tabular-nums" style={{ color: colors.inkMuted }}>
            {sub.items
              .map(
                (i) =>
                  `${formatMoney(i.amountCents * i.quantity, i.currency ?? 'cad')}/${i.interval ?? '?'}${i.quantity > 1 ? ` (${i.quantity} × ${formatMoney(i.amountCents, i.currency ?? 'cad')})` : ''}`,
              )
              .join(' + ')}
          </p>
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            {[
              `Started ${formatDate(sub.created)}`,
              sub.endedAt
                ? `Ended ${formatDate(sub.endedAt)}`
                : sub.currentPeriodEnd
                  ? `${sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${formatDate(sub.currentPeriodEnd)}`
                  : null,
              sub.discount
                ? `Coupon ${sub.discount.name}: ${sub.discount.percentOff ? `${sub.discount.percentOff}%` : formatMoney(sub.discount.amountOffCents ?? 0)} off (${sub.discount.duration})`
                : null,
              sub.id,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      {isLive ? (
        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: colors.border }}>
          {sub.kind === 'plan' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                aria-label="New plan"
                value={newTier}
                onChange={(e) => setNewTier(e.target.value)}
                options={PAID_TIER_OPTIONS}
                containerClassName="sm:w-44"
              />
              <Checkbox checked={prorate} onChange={setProrate} label="Prorate" />
              <Button
                label="Change Plan"
                size="sm"
                variant="secondary"
                disabled={newTier === sub.tier}
                loading={changePlan.isPending}
                onClick={onChangePlan}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              label={`Next billing date${sub.currentPeriodEnd ? ` (now ${formatDate(sub.currentPeriodEnd)})` : ''}`}
              type="date"
              value={billingDate}
              onChange={(e) => setBillingDateValue(e.target.value)}
              containerClassName="sm:w-56"
            />
            <Button
              label="Move Billing Date"
              size="sm"
              variant="secondary"
              disabled={!billingDate}
              loading={setBillingDate.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Move Billing Date',
                  message: `Nothing will be charged until ${billingDate}. The date must be after the current billing date and within a year.`,
                  confirmLabel: 'Move',
                });
                if (!ok) return;
                await run(
                  'Move Billing Date',
                  () => setBillingDate.mutateAsync({ accountId, subscriptionId: sub.id, date: billingDate }),
                  `Next billing date is now ${billingDate}.`,
                );
                setBillingDateValue('');
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {sub.cancelAtPeriodEnd ? (
              <Button
                label="Resume"
                size="sm"
                variant="secondary"
                loading={resume.isPending}
                onClick={() =>
                  run('Resume', () => resume.mutateAsync({ accountId, subscriptionId: sub.id }), 'Subscription resumed.')
                }
              />
            ) : (
              <Button label="Cancel at Period End" size="sm" variant="secondary" loading={cancel.isPending} onClick={() => onCancel('period_end')} />
            )}
            <Button label="Cancel Now" size="sm" variant="danger" loading={cancel.isPending} onClick={() => onCancel('now')} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreditSection({ accountId, balanceCents }: { accountId: string; balanceCents: number }) {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const add = useAddAccountCreditMutation();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const submit = async () => {
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars < 1 || dollars > 1000) {
      await alert('Check Amount', 'Enter a credit from $1 to $1,000.');
      return;
    }
    if (!note.trim()) {
      await alert('Add a Note', 'Say why this credit is being given.');
      return;
    }
    const ok = await confirm({
      title: 'Add Credit',
      message: `Give ${formatDollars(dollars)} credit? It is taken off the next invoices automatically.`,
      confirmLabel: 'Add Credit',
    });
    if (!ok) return;
    try {
      await add.mutateAsync({
        accountId,
        amountCents: Math.round(dollars * 100),
        note: note.trim(),
        idempotencyKey: `credit-${accountId}-${Date.now()}`,
      });
      toast('Credit added.', 'success');
      setAmount('');
      setNote('');
    } catch (e) {
      await alert('Could Not Add Credit', errorMessage(e));
    }
  };

  return (
    <FounderSection title="Account credit">
      <p className="text-sm" style={{ color: colors.inkMuted }}>
        Credit on file: {formatDollars(balanceCents / 100)}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input label="Amount (CAD)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} containerClassName="sm:w-36" />
        <Input label="Reason" value={note} onChange={(e) => setNote(e.target.value)} containerClassName="sm:flex-1" />
        <Button label="Add Credit" size="sm" variant="secondary" loading={add.isPending} onClick={submit} />
      </div>
    </FounderSection>
  );
}

const formatDollars = (dollars: number) => `$${dollars.toFixed(2)}`;

function ManualAccessSection({ account, hasLiveStripe }: { account: FounderSubscriptionAccount; hasLiveStripe: boolean }) {
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  const update = useUpdateOrganizationAccessMutation();
  const refresh = useInvalidateBilling();
  const [planTier, setPlanTier] = useState(account.planTier);
  // Only the plan is editable here: the account's current access setting is sent back unchanged.
  const access: FounderAccessKind = account.isComp ? 'comp' : account.trialEndsAt ? 'trial' : 'active';
  const trialDays = account.trialEndsAt ? Math.max(1, daysUntil(account.trialEndsAt)) : 30;

  const submit = async () => {
    try {
      await update.mutateAsync({ accountId: account.id, planTier, access, trialDays: access === 'trial' ? trialDays : undefined });
      refresh();
      toast(`${account.name} updated.`, 'success');
    } catch (e) {
      await alert('Could Not Update', errorMessage(e));
    }
  };

  return (
    <FounderSection title="Manual plan">
      <p className="text-sm" style={{ color: colors.inkMuted }}>
        Sets the plan in SquadOwl without charging anything — for comps, pilots and fixing a stuck account.
      </p>
      {hasLiveStripe ? (
        <p className="text-xs" style={{ color: colors.warning }}>
          This account has a live Stripe subscription. The next Stripe update will set the plan back to what they pay
          for, and comping it doesn&apos;t stop the billing — cancel the subscription above first.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Plan" value={planTier} onChange={(e) => setPlanTier(e.target.value)} options={PLAN_OPTIONS} />
      </div>
      <div>
        <Button label="Save Plan" loading={update.isPending} onClick={submit} />
      </div>
    </FounderSection>
  );
}
