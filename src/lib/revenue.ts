/**
 * Revenue dashboard maths for the founder console. The founder-billing edge
 * function hands back every Stripe subscription (already normalised to a
 * monthly value) plus succeeded charges; everything here is pure so it can be
 * tested without Stripe.
 *
 * Known approximation: a subscription's history is reconstructed from its
 * start/end dates and its *current* price, so a plan change mid-life is
 * back-dated to the start. Only CAD is summed (SquadOwl bills in CAD); other
 * currencies are counted in `otherCurrencySubscriptions` so they aren't
 * silently dropped.
 */

export interface RevenueSubscription {
  id: string;
  customerId: string | null;
  status: string;
  /** Plan tier, or null for an add-on (team licenses). */
  tier: string | null;
  currency: string | null;
  mrrCents: number;
  startedAt: number;
  trialEndsAt: number | null;
  endedAt: number | null;
  cancelAtPeriodEnd: boolean;
}

export interface RevenueCharge {
  /** 'YYYY-MM' (UTC). */
  month: string;
  currency: string;
  amountCents: number;
  refundedCents: number;
}

export interface RevenueData {
  months: number;
  generatedAt: number;
  truncated: boolean;
  subscriptions: RevenueSubscription[];
  charges: RevenueCharge[];
}

export interface RevenueMonth {
  month: string;
  /** MRR at the end of the month (or now, for the current month). */
  mrrCents: number;
  subscribers: number;
  newSubscribers: number;
  churnedSubscribers: number;
  /** Churned ÷ subscribers at the start of the month; null when there were none. */
  churnRate: number | null;
  collectedCents: number;
  refundedCents: number;
}

export interface RevenueSummary {
  mrrCents: number;
  arrCents: number;
  subscribers: number;
  trialing: number;
  /** Average revenue per paying account, monthly. */
  arpaCents: number;
  /** Subscribers who stopped paying in the last 30 days ÷ subscribers 30 days ago. */
  churnRate30d: number | null;
  churned30d: number;
  /** Paying now, but set to cancel at period end. */
  cancelingSubscribers: number;
  byTier: { tier: string; subscribers: number; mrrCents: number }[];
  series: RevenueMonth[];
  otherCurrencySubscriptions: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** Statuses that still count as paying right now (matches stripe-webhook's ENTITLING, minus trials). */
const PAYING_NOW = new Set(['active', 'past_due']);

const isCad = (s: { currency: string | null }) => (s.currency ?? '').toLowerCase() === 'cad';

/** Whether `sub` was bringing in revenue at time `t`. */
export function isPayingAt(sub: RevenueSubscription, t: number, now: number): boolean {
  if (sub.mrrCents <= 0) return false;
  if (sub.startedAt > t) return false;
  if (sub.endedAt != null && sub.endedAt <= t) return false;
  if (sub.trialEndsAt != null && sub.trialEndsAt > t) return false;
  // Only the present has a trustworthy status (unpaid / paused subscriptions
  // keep no end date); the past is judged on dates alone.
  if (t >= now) return PAYING_NOW.has(sub.status);
  return sub.status !== 'incomplete' && sub.status !== 'incomplete_expired';
}

/** Paying customers at `t` → their total MRR. Customers, not subscriptions: an upgrade swaps subscriptions without churning anyone. */
export function payingCustomersAt(subs: RevenueSubscription[], t: number, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const sub of subs) {
    if (!isPayingAt(sub, t, now)) continue;
    const key = sub.customerId ?? sub.id;
    out.set(key, (out.get(key) ?? 0) + sub.mrrCents);
  }
  return out;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** Month keys, oldest first, ending with the month containing `now` (UTC). */
export function monthKeys(count: number, now: number): string[] {
  const d = new Date(now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    keys.push(m.toISOString().slice(0, 7));
  }
  return keys;
}

function monthBounds(key: string): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

export function summarizeRevenue(data: RevenueData, now = data.generatedAt): RevenueSummary {
  const subs = data.subscriptions.filter(isCad);

  const current = payingCustomersAt(subs, now, now);
  const before = payingCustomersAt(subs, now - 30 * DAY, now);
  const churned30d = [...before.keys()].filter((c) => !current.has(c)).length;
  const mrrCents = sum(current);

  const tierTotals = new Map<string, { subscribers: Set<string>; mrrCents: number }>();
  const canceling = new Set<string>();
  for (const sub of subs) {
    if (!isPayingAt(sub, now, now)) continue;
    const customer = sub.customerId ?? sub.id;
    if (sub.cancelAtPeriodEnd) canceling.add(customer);
    const key = sub.tier ?? 'addon';
    const entry = tierTotals.get(key) ?? { subscribers: new Set<string>(), mrrCents: 0 };
    entry.subscribers.add(customer);
    entry.mrrCents += sub.mrrCents;
    tierTotals.set(key, entry);
  }

  const collected = new Map<string, { collected: number; refunded: number }>();
  for (const c of data.charges) {
    if (c.currency.toLowerCase() !== 'cad') continue;
    const entry = collected.get(c.month) ?? { collected: 0, refunded: 0 };
    entry.collected += c.amountCents;
    entry.refunded += c.refundedCents;
    collected.set(c.month, entry);
  }

  const series = monthKeys(data.months, now).map((month): RevenueMonth => {
    const [start, end] = monthBounds(month);
    const atStart = payingCustomersAt(subs, start, now);
    const atEnd = payingCustomersAt(subs, Math.min(end, now), now);
    const churnedSubscribers = [...atStart.keys()].filter((c) => !atEnd.has(c)).length;
    const newSubscribers = [...atEnd.keys()].filter((c) => !atStart.has(c)).length;
    return {
      month,
      mrrCents: sum(atEnd),
      subscribers: atEnd.size,
      newSubscribers,
      churnedSubscribers,
      churnRate: atStart.size ? churnedSubscribers / atStart.size : null,
      collectedCents: collected.get(month)?.collected ?? 0,
      refundedCents: collected.get(month)?.refunded ?? 0,
    };
  });

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    subscribers: current.size,
    trialing: new Set(
      subs
        .filter((s) => s.status === 'trialing' && s.trialEndsAt != null && s.trialEndsAt > now)
        .map((s) => s.customerId ?? s.id),
    ).size,
    arpaCents: current.size ? Math.round(mrrCents / current.size) : 0,
    churnRate30d: before.size ? churned30d / before.size : null,
    churned30d,
    cancelingSubscribers: canceling.size,
    byTier: [...tierTotals.entries()]
      .map(([tier, v]) => ({ tier, subscribers: v.subscribers.size, mrrCents: v.mrrCents }))
      .sort((a, b) => b.mrrCents - a.mrrCents),
    series,
    otherCurrencySubscriptions: data.subscriptions.length - subs.length,
  };
}
