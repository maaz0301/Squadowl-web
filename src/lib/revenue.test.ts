import { describe, expect, it } from 'vitest';

import { isPayingAt, monthKeys, summarizeRevenue, type RevenueSubscription } from './revenue';

const NOW = Date.UTC(2026, 8, 17); // 2026-09-17
const DAY = 24 * 60 * 60 * 1000;

function sub(overrides: Partial<RevenueSubscription>): RevenueSubscription {
  return {
    id: overrides.id ?? `sub_${Math.random().toString(36).slice(2)}`,
    customerId: 'cus_a',
    status: 'active',
    tier: 'club',
    currency: 'cad',
    mrrCents: 833,
    startedAt: Date.UTC(2026, 0, 10),
    trialEndsAt: null,
    endedAt: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe('monthKeys', () => {
  it('ends with the current month and crosses year boundaries', () => {
    expect(monthKeys(3, Date.UTC(2026, 0, 5))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('isPayingAt', () => {
  it('does not count a trial until it ends', () => {
    const s = sub({ status: 'active', trialEndsAt: Date.UTC(2026, 1, 1) });
    expect(isPayingAt(s, Date.UTC(2026, 0, 20), NOW)).toBe(false);
    expect(isPayingAt(s, Date.UTC(2026, 1, 2), NOW)).toBe(true);
  });

  it('trusts the live status only for the present', () => {
    const unpaid = sub({ status: 'unpaid' });
    expect(isPayingAt(unpaid, NOW, NOW)).toBe(false);
    expect(isPayingAt(unpaid, Date.UTC(2026, 5, 1), NOW)).toBe(true);
  });
});

describe('summarizeRevenue', () => {
  it('treats an upgrade (old sub ended, new one started) as no churn', () => {
    const switchedAt = Date.UTC(2026, 6, 15);
    const data = {
      months: 3,
      generatedAt: NOW,
      truncated: false,
      charges: [],
      subscriptions: [
        sub({ id: 'old', tier: 'coach', mrrCents: 333, endedAt: switchedAt, status: 'canceled' }),
        sub({ id: 'new', tier: 'club', mrrCents: 833, startedAt: switchedAt }),
      ],
    };
    const r = summarizeRevenue(data);
    expect(r.subscribers).toBe(1);
    expect(r.mrrCents).toBe(833);
    expect(r.series.map((m) => m.churnedSubscribers)).toEqual([0, 0, 0]);
    expect(r.series.find((m) => m.month === '2026-07')?.mrrCents).toBe(833);
  });

  it('computes churn, new subscribers and 30-day churn', () => {
    const data = {
      months: 2,
      generatedAt: NOW,
      truncated: false,
      charges: [
        { month: '2026-09', currency: 'cad', amountCents: 9999, refundedCents: 1000 },
        { month: '2026-09', currency: 'usd', amountCents: 5000, refundedCents: 0 },
      ],
      subscriptions: [
        sub({ customerId: 'cus_a', mrrCents: 833 }),
        sub({ customerId: 'cus_b', mrrCents: 333, endedAt: NOW - 5 * DAY, status: 'canceled' }),
        sub({ customerId: 'cus_c', mrrCents: 583, startedAt: Date.UTC(2026, 8, 3), cancelAtPeriodEnd: true }),
        sub({ customerId: 'cus_d', currency: 'usd' }),
      ],
    };
    const r = summarizeRevenue(data);
    expect(r.subscribers).toBe(2);
    expect(r.mrrCents).toBe(833 + 583);
    expect(r.arrCents).toBe((833 + 583) * 12);
    expect(r.churned30d).toBe(1);
    expect(r.churnRate30d).toBe(0.5);
    expect(r.cancelingSubscribers).toBe(1);
    expect(r.otherCurrencySubscriptions).toBe(1);

    const sept = r.series[1];
    expect(sept.month).toBe('2026-09');
    expect(sept.churnedSubscribers).toBe(1);
    expect(sept.newSubscribers).toBe(1);
    expect(sept.churnRate).toBe(0.5);
    expect(sept.collectedCents).toBe(9999);
    expect(sept.refundedCents).toBe(1000);
  });
});
