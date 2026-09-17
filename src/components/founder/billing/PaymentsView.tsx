'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Select,
  Spinner,
  Tabs,
  Textarea,
  useAlert,
} from '@/components/ui';
import type { BillingPayment, PaymentStatusFilter, RefundReason } from '@/data/founder/types';
import { usePaymentQuery, usePaymentsQuery, useRefundPaymentMutation } from '@/features/founderQueries';
import { useDebouncedValue } from '@/lib/hooks';
import { FounderDetails, FounderSection } from '../FounderUi';
import { formatDate } from '../labels';
import { errorMessage, formatMoney } from './format';

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'succeeded', label: 'Succeeded' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'failed', label: 'Failed' },
  { key: 'disputed', label: 'Disputed' },
];

function paymentBadge(p: BillingPayment): { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' } {
  if (p.disputed) return { label: 'Disputed', variant: 'danger' };
  if (p.status === 'failed') return { label: 'Failed', variant: 'danger' };
  if (p.status === 'pending') return { label: 'Pending', variant: 'info' };
  if (p.refunded) return { label: 'Refunded', variant: 'default' };
  if (p.amountRefundedCents > 0) {
    return { label: `Partly refunded · ${formatMoney(p.amountRefundedCents, p.currency)}`, variant: 'warning' };
  }
  return { label: 'Paid', variant: 'success' };
}

export function PaymentsView({
  account,
  onClearAccount,
}: {
  /** Set when opened from an account's "View payments". */
  account: { id: string; name: string } | null;
  onClearAccount: () => void;
}) {
  const colors = useThemeColors();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebouncedValue(search.trim(), 400);

  const query = usePaymentsQuery({
    search: account ? undefined : debounced || undefined,
    status: status === 'all' ? undefined : (status as PaymentStatusFilter),
    accountId: account?.id,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const note = query.data?.pages[0]?.note;

  return (
    <>
      <div className="mb-3 flex flex-col gap-3">
        {account ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: colors.inkMuted }}>
            Payments for <strong style={{ color: colors.ink }}>{account.name}</strong>
            <Button label="Show all payments" size="sm" variant="ghost" onClick={onClearAccount} />
          </div>
        ) : (
          <Input
            placeholder="Search organization, email, or a Stripe id (ch_, pi_, in_, cus_)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoCorrect="off"
          />
        )}
        <Tabs tabs={STATUS_TABS} activeKey={status} onChange={setStatus} />
      </div>

      {query.isLoading ? (
        <LoadingState message="Loading payments from Stripe..." />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, 'Could not load payments.')} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No payments"
          message={note ?? (search || status !== 'all' ? 'Nothing matches that search.' : 'Stripe has no charges yet.')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((p) => {
            const badge = paymentBadge(p);
            return (
              <button key={p.id} type="button" className="block text-left transition hover:brightness-110" onClick={() => setOpenId(p.id)}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold tabular-nums" style={{ color: colors.ink }}>
                        {formatMoney(p.amountCents, p.currency)}
                      </span>
                      <Badge label={badge.label} variant={badge.variant} />
                    </div>
                    <p className="truncate text-sm" style={{ color: colors.inkMuted }}>
                      {p.accountName ?? p.email ?? p.customerId ?? 'Unknown customer'}
                      {p.accountName && p.email ? ` · ${p.email}` : ''}
                    </p>
                    <p className="truncate text-xs" style={{ color: colors.inkFaint }}>
                      {[p.description, p.cardBrand && p.cardLast4 ? `${p.cardBrand} •••• ${p.cardLast4}` : null, p.id]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs" style={{ color: colors.inkFaint }}>
                    {formatDate(p.created, true)}
                  </span>
                </Card>
              </button>
            );
          })}
          {query.hasNextPage ? (
            <Button
              label="Load more"
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            />
          ) : null}
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            Every charge on the TryoutHQ Stripe account, newest first. Searches and status filters use Stripe search,
            which can lag new payments by about a minute.
          </p>
        </div>
      )}

      {openId ? <PaymentDetailModal chargeId={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function PaymentDetailModal({ chargeId, onClose }: { chargeId: string; onClose: () => void }) {
  const colors = useThemeColors();
  const query = usePaymentQuery(chargeId);
  const [refunding, setRefunding] = useState(false);
  const p = query.data;
  const refundable = p && p.status === 'succeeded' ? p.amountCents - p.amountRefundedCents : 0;

  return (
    <>
      <Modal
        visible={!refunding}
        title="Payment"
        size="md"
        onClose={onClose}
        hideDefaultFooter
        footer={
          <ModalFooter>
            <Button label="Close" variant="ghost" onClick={onClose} />
            {refundable > 0 ? <Button label="Refund" variant="danger" onClick={() => setRefunding(true)} /> : null}
          </ModalFooter>
        }
      >
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : query.isError || !p ? (
          <p className="text-sm" style={{ color: colors.danger }}>
            {errorMessage(query.error, 'Could not load this payment.')}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-bold tabular-nums" style={{ color: colors.ink }}>
                {formatMoney(p.amountCents, p.currency)}
              </span>
              <Badge label={paymentBadge(p).label} variant={paymentBadge(p).variant} />
            </div>

            <FounderDetails
              rows={[
                [
                  'Account',
                  p.accountId ? (
                    <Link href={`/founder/organizations/${p.accountId}`} className="underline" style={{ color: colors.ink }}>
                      {p.accountName}
                    </Link>
                  ) : undefined,
                ],
                ['Email', p.email ?? undefined],
                ['Date', formatDate(p.created, true)],
                ['Description', p.description ?? undefined],
                ['Card', p.cardBrand && p.cardLast4 ? `${p.cardBrand} •••• ${p.cardLast4}` : undefined],
                ['Failure', p.failureMessage ?? undefined],
                ['Refunded', p.amountRefundedCents ? formatMoney(p.amountRefundedCents, p.currency) : undefined],
                ['Charge', p.id],
                ['Payment intent', p.paymentIntentId ?? undefined],
                ['Customer', p.customerId ?? undefined],
              ]}
            />

            <div className="flex flex-wrap gap-3 text-sm">
              {p.receiptUrl ? (
                <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: colors.primary }}>
                  Receipt
                </a>
              ) : null}
              {p.invoice?.hostedUrl ? (
                <a href={p.invoice.hostedUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: colors.primary }}>
                  Invoice {p.invoice.number ?? ''}
                </a>
              ) : null}
              {p.invoice?.pdfUrl ? (
                <a href={p.invoice.pdfUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: colors.primary }}>
                  Invoice PDF
                </a>
              ) : null}
            </div>

            {p.invoice?.lines.length ? (
              <FounderSection title="Invoice">
                <div className="flex flex-col gap-1 text-sm">
                  {p.invoice.lines.map((l, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words" style={{ color: colors.inkMuted }}>
                        {l.description ?? 'Line item'}
                        {l.periodStart && l.periodEnd ? (
                          <span className="block text-xs" style={{ color: colors.inkFaint }}>
                            {formatDate(l.periodStart)} – {formatDate(l.periodEnd)}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 tabular-nums" style={{ color: colors.ink }}>
                        {formatMoney(l.amountCents, p.currency)}
                      </span>
                    </div>
                  ))}
                  {p.invoice.discountCents ? (
                    <div className="flex justify-between gap-3" style={{ color: colors.success }}>
                      <span>Discount</span>
                      <span className="tabular-nums">−{formatMoney(p.invoice.discountCents, p.currency)}</span>
                    </div>
                  ) : null}
                </div>
              </FounderSection>
            ) : null}

            {p.refunds.length ? (
              <FounderSection title="Refunds">
                {p.refunds.map((r) => (
                  <div key={r.id} className="flex flex-col gap-0.5 rounded-xl border p-3 text-sm" style={{ borderColor: colors.border }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums" style={{ color: colors.ink }}>
                        {formatMoney(r.amountCents, p.currency)}
                      </span>
                      <span className="text-xs" style={{ color: colors.inkFaint }}>
                        {r.status} · {formatDate(r.created, true)}
                      </span>
                    </div>
                    {r.note ? (
                      <p className="break-words" style={{ color: colors.inkMuted }}>
                        {r.note}
                      </p>
                    ) : null}
                    <p className="text-xs" style={{ color: colors.inkFaint }}>
                      {[r.reason?.replace(/_/g, ' '), r.refundedBy ? `by ${r.refundedBy}` : 'issued outside the console']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                ))}
              </FounderSection>
            ) : null}
          </div>
        )}
      </Modal>

      {refunding && p ? (
        <RefundModal
          payment={p}
          refundableCents={refundable}
          onClose={() => setRefunding(false)}
          onDone={() => {
            setRefunding(false);
            void query.refetch();
          }}
        />
      ) : null}
    </>
  );
}

const REASON_OPTIONS: { value: RefundReason; label: string }[] = [
  { value: 'requested_by_customer', label: 'Requested by customer' },
  { value: 'duplicate', label: 'Duplicate charge' },
  { value: 'fraudulent', label: 'Fraudulent' },
];

function RefundModal({
  payment,
  refundableCents,
  onClose,
  onDone,
}: {
  payment: BillingPayment;
  refundableCents: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const refund = useRefundPaymentMutation();
  const [full, setFull] = useState(true);
  const [amount, setAmount] = useState((refundableCents / 100).toFixed(2));
  const [reason, setReason] = useState<RefundReason>('requested_by_customer');
  const [note, setNote] = useState('');
  // One key per opening of this dialog: a double-click or a retry after a
  // timeout can't refund twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const submit = async () => {
    const cents = full ? refundableCents : Math.round(Number(amount) * 100);
    if (!full && !(cents >= 1 && cents <= refundableCents)) {
      await alert('Check the Amount', `Enter between ${formatMoney(1, payment.currency)} and ${formatMoney(refundableCents, payment.currency)}.`);
      return;
    }
    if (!note.trim()) {
      await alert('Add a Note', 'Say why this is being refunded — it is kept on the refund in Stripe and in the audit log.');
      return;
    }
    const ok = await confirm({
      title: 'Issue Refund',
      message: `Refund ${formatMoney(cents, payment.currency)} to ${payment.accountName ?? payment.email ?? 'this customer'}? This goes straight to their card and can't be undone.\n\nThis does not cancel their subscription — do that from Subscriptions if needed.`,
      confirmLabel: 'Refund',
      destructive: true,
    });
    if (!ok) return;
    try {
      await refund.mutateAsync({
        chargeId: payment.id,
        amountCents: full ? undefined : cents,
        reason,
        note: note.trim(),
        idempotencyKey,
      });
      toast(`Refunded ${formatMoney(cents, payment.currency)}.`, 'success');
      onDone();
    } catch (e) {
      await alert('Refund Failed', errorMessage(e));
    }
  };

  return (
    <Modal
      visible
      title="Refund Payment"
      size="sm"
      onClose={onClose}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Refund" variant="danger" loading={refund.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: colors.inkMuted }}>
          {formatMoney(payment.amountCents, payment.currency)} paid {formatDate(payment.created)}
          {payment.amountRefundedCents ? `, ${formatMoney(payment.amountRefundedCents, payment.currency)} already refunded` : ''}.
        </p>
        <Tabs
          tabs={[
            { key: 'full', label: `Full · ${formatMoney(refundableCents, payment.currency)}` },
            { key: 'partial', label: 'Partial' },
          ]}
          activeKey={full ? 'full' : 'partial'}
          onChange={(k) => setFull(k === 'full')}
        />
        {!full ? (
          <Input
            label={`Amount (${payment.currency.toUpperCase()})`}
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            max={refundableCents / 100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        ) : null}
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as RefundReason)} options={REASON_OPTIONS} />
        <Textarea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Charged twice after the upgrade; customer emailed support Sept 17"
          rows={3}
          maxLength={450}
        />
      </div>
    </Modal>
  );
}
