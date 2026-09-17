'use client';

import { useState } from 'react';
import { LoadingState, PageHeader, Tabs } from '@/components/ui';
import { FounderNotAvailable } from '@/components/founder/FounderUi';
import { DiscountCodesView } from '@/components/founder/billing/DiscountCodesView';
import { PaymentsView } from '@/components/founder/billing/PaymentsView';
import { RevenueView } from '@/components/founder/billing/RevenueView';
import { SubscriptionsView } from '@/components/founder/billing/SubscriptionsView';
import { useIsFounderQuery } from '@/features/founderQueries';

const VIEW_TABS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'payments', label: 'Payments & Refunds' },
  { key: 'discounts', label: 'Discount Codes' },
];

/** Founder console — founder@tryout.ca only. Same double-gated pattern as /founder (see that page). */
export default function FounderBillingPage() {
  const founderQuery = useIsFounderQuery();
  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  return <Billing />;
}

function Billing() {
  const [view, setView] = useState('revenue');
  const [paymentsAccount, setPaymentsAccount] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <PageHeader title="Billing & Revenue" subtitle="Revenue, subscriptions, payments, refunds and discount codes" />
      <Tabs tabs={VIEW_TABS} activeKey={view} onChange={setView} className="mb-4" />
      {view === 'revenue' ? <RevenueView /> : null}
      {view === 'subscriptions' ? (
        <SubscriptionsView
          onViewPayments={(account) => {
            setPaymentsAccount(account);
            setView('payments');
          }}
        />
      ) : null}
      {view === 'payments' ? (
        <PaymentsView account={paymentsAccount} onClearAccount={() => setPaymentsAccount(null)} />
      ) : null}
      {view === 'discounts' ? <DiscountCodesView /> : null}
    </>
  );
}
