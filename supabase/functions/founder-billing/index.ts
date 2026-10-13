import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@14.21.0';
import { corsHeaders } from '../_shared/cors.ts';
import { json, requireFounder } from '../_shared/founder.ts';
import { TIER_PRICES_CAD, configuredPriceId, stripe, tierForPrice } from '../_shared/stripe.ts';

/**
 * Founder console — Billing & Revenue. founder@tryout.ca only.
 *
 * Everything that needs the Stripe secret key: the payment log, refunds,
 * changing/cancelling a customer's Stripe subscription, and the raw
 * subscription + charge data the Revenue dashboard is computed from
 * (src/lib/revenue.ts). Discount codes and the subscription list are plain
 * RPCs (20260917130000_founder_billing.sql).
 *
 * Subscription changes made here fire customer.subscription.updated, and
 * stripe-webhook reconciles accounts.plan_tier from that — this function
 * never writes plan_tier itself, so the two can't disagree.
 */

type Body = Record<string, unknown>;
type Ctx = { caller: User; admin: SupabaseClient; body: Body };

class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function audit(
  { caller, admin }: Ctx,
  action: string,
  accountId: string | null,
  accountName: string | null,
  reason: string | null,
  details: Record<string, unknown>,
) {
  // Service role bypasses RLS; see founder-user-admin for why this is a direct insert.
  const { error } = await admin.from('founder_audit_log').insert({
    actor_id: caller.id,
    actor_email: caller.email,
    action,
    account_id: accountId,
    account_name: accountName,
    reason: reason?.trim() || null,
    details,
  });
  if (error) console.error('founder-billing: audit insert failed', error);
}

async function accountById(admin: SupabaseClient, accountId: string) {
  const { data, error } = await admin
    .from('accounts')
    .select('id, name, stripe_customer_id, stripe_subscription_id, plan_tier')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError('Account not found.', 404);
  return data as { id: string; name: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; plan_tier: string };
}

/** stripe_customer_id → { id, name } for the customers on one page of results. */
async function accountsByCustomer(admin: SupabaseClient, customerIds: string[]) {
  const ids = [...new Set(customerIds.filter(Boolean))];
  const map = new Map<string, { id: string; name: string }>();
  if (!ids.length) return map;
  const { data } = await admin.from('accounts').select('id, name, stripe_customer_id').in('stripe_customer_id', ids);
  for (const a of data ?? []) map.set(a.stripe_customer_id, { id: a.id, name: a.name });
  return map;
}

const idOf = (ref: unknown): string | null =>
  typeof ref === 'string' ? ref : ((ref as { id?: string } | null)?.id ?? null);

/** A request-body field, kept only when the client actually sent a string. */
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function chargeRow(c: Stripe.Charge, accounts: Map<string, { id: string; name: string }>) {
  const customerId = idOf(c.customer);
  const account = customerId ? accounts.get(customerId) : undefined;
  const card = c.payment_method_details?.card;
  const customerEmail = c.customer && typeof c.customer === 'object' && 'email' in c.customer ? c.customer.email : null;
  return {
    id: c.id,
    amountCents: c.amount,
    amountRefundedCents: c.amount_refunded,
    currency: c.currency,
    status: c.status,
    refunded: c.refunded,
    disputed: c.disputed,
    created: c.created * 1000,
    description: c.description ?? null,
    customerId,
    email: c.billing_details?.email ?? c.receipt_email ?? customerEmail ?? null,
    accountId: account?.id ?? null,
    accountName: account?.name ?? null,
    invoiceId: idOf(c.invoice),
    paymentIntentId: idOf(c.payment_intent),
    receiptUrl: c.receipt_url ?? null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    failureMessage: c.failure_message ?? null,
  };
}

/** Customer ids whose account name, owner email or Stripe email matches `q`. Stripe search takes at most 10 OR clauses. */
async function customersMatching(admin: SupabaseClient, q: string): Promise<string[]> {
  const found = new Set<string>();
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const { data: byName } = await admin
    .from('accounts')
    .select('stripe_customer_id')
    .ilike('name', like)
    .not('stripe_customer_id', 'is', null)
    .limit(10);
  for (const a of byName ?? []) found.add(a.stripe_customer_id);

  const { data: people } = await admin.from('profiles').select('id').ilike('email', like).limit(20);
  const userIds = (people ?? []).map((p: { id: string }) => p.id);
  if (userIds.length) {
    const { data: owned } = await admin
      .from('memberships')
      .select('accounts!inner(stripe_customer_id)')
      .in('user_id', userIds)
      .in('role', ['owner', 'admin']);
    // Supabase's inner-join select can come back as either shape depending on
    // how it infers the relationship's cardinality; handle both.
    type MembershipAccountRow = {
      accounts: { stripe_customer_id: string | null } | { stripe_customer_id: string | null }[] | null;
    };
    for (const m of (owned ?? []) as MembershipAccountRow[]) {
      const acc = Array.isArray(m.accounts) ? m.accounts[0] : m.accounts;
      if (acc?.stripe_customer_id) found.add(acc.stripe_customer_id);
    }
  }

  if (found.size < 10 && !/['"\\]/.test(q)) {
    try {
      const res = await stripe.customers.search({ query: `email~"${q}"`, limit: 10 });
      for (const c of res.data) found.add(c.id);
    } catch (e) {
      console.warn('founder-billing: customer search failed', e);
    }
  }
  return [...found].slice(0, 10);
}

// ─── Payments ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const STATUS_QUERY: Record<string, string> = {
  succeeded: "status:'succeeded'",
  failed: "status:'failed'",
  refunded: "refunded:'true'",
  disputed: "disputed:'true'",
};

async function listPayments({ admin, body }: Ctx) {
  const search = String(body.search ?? '').trim();
  const statusParam = String(body.status ?? '');
  const status = STATUS_QUERY[statusParam] ? statusParam : null;
  const cursor = String(body.cursor ?? '') || undefined;

  let charges: Stripe.Charge[] = [];
  let nextCursor: string | null = null;
  // Stripe search can't mix AND with OR, so a status filter on a multi-customer
  // search is applied to the returned page instead.
  let filterStatusLocally = false;

  const runSearch = async (query: string) => {
    const res = await stripe.charges.search({ query, limit: PAGE_SIZE, page: cursor, expand: ['data.customer'] });
    charges = res.data;
    nextCursor = res.has_more ? (res.next_page ?? null) : null;
  };

  const accountIdParam = String(body.accountId ?? '');
  if (accountIdParam) {
    const account = await accountById(admin, accountIdParam);
    if (!account.stripe_customer_id) return { items: [], nextCursor: null, note: 'This account has never been billed.' };
    const clause = `customer:'${account.stripe_customer_id}'`;
    await runSearch(status ? `${clause} AND ${STATUS_QUERY[status]}` : clause);
  } else if (/^(ch|py)_\w+$/.test(search)) {
    try {
      charges = [await stripe.charges.retrieve(search, { expand: ['customer'] })];
    } catch {
      charges = [];
    }
  } else if (/^pi_\w+$/.test(search)) {
    charges = (await stripe.charges.list({ payment_intent: search, expand: ['data.customer'] })).data;
  } else if (/^in_\w+$/.test(search)) {
    try {
      const invoice = await stripe.invoices.retrieve(search);
      const chargeId = idOf(invoice.charge);
      charges = chargeId ? [await stripe.charges.retrieve(chargeId, { expand: ['customer'] })] : [];
    } catch {
      charges = [];
    }
  } else if (search) {
    const customers = /^cus_\w+$/.test(search) ? [search] : await customersMatching(admin, search);
    if (!customers.length) return { items: [], nextCursor: null };
    const clause = customers.map((id) => `customer:'${id}'`).join(' OR ');
    if (customers.length === 1 && status) {
      await runSearch(`${clause} AND ${STATUS_QUERY[status]}`);
    } else {
      await runSearch(clause);
      filterStatusLocally = !!status;
    }
  } else if (status) {
    await runSearch(STATUS_QUERY[status]);
  } else {
    const res = await stripe.charges.list({ limit: PAGE_SIZE, starting_after: cursor, expand: ['data.customer'] });
    charges = res.data;
    nextCursor = res.has_more ? (res.data[res.data.length - 1]?.id ?? null) : null;
  }

  if (filterStatusLocally && status) {
    charges = charges.filter((c) =>
      status === 'refunded' ? c.refunded || c.amount_refunded > 0 : status === 'disputed' ? c.disputed : c.status === status,
    );
  }

  const accounts = await accountsByCustomer(admin, charges.map((c) => idOf(c.customer) ?? ''));
  return { items: charges.map((c) => chargeRow(c, accounts)), nextCursor };
}

async function getPayment({ admin, body }: Ctx) {
  if (!body.chargeId) throw new HttpError('Missing chargeId');
  const charge = await stripe.charges.retrieve(String(body.chargeId), {
    expand: ['customer', 'refunds', 'invoice'],
  });
  const accounts = await accountsByCustomer(admin, [idOf(charge.customer) ?? '']);
  const invoice = typeof charge.invoice === 'object' ? charge.invoice : null;
  return {
    ...chargeRow(charge, accounts),
    refunds: (charge.refunds?.data ?? []).map((r) => ({
      id: r.id,
      amountCents: r.amount,
      status: r.status,
      reason: r.reason ?? null,
      note: r.metadata?.note ?? null,
      refundedBy: r.metadata?.refunded_by ?? null,
      created: r.created * 1000,
    })),
    invoice: invoice
      ? {
          id: invoice.id,
          number: invoice.number ?? null,
          hostedUrl: invoice.hosted_invoice_url ?? null,
          pdfUrl: invoice.invoice_pdf ?? null,
          subtotalCents: invoice.subtotal,
          discountCents: (invoice.total_discount_amounts ?? []).reduce((s, d) => s + d.amount, 0),
          lines: (invoice.lines?.data ?? []).map((l) => ({
            description: l.description ?? null,
            amountCents: l.amount,
            periodStart: l.period?.start ? l.period.start * 1000 : null,
            periodEnd: l.period?.end ? l.period.end * 1000 : null,
          })),
        }
      : null,
  };
}

const REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'] as const;

async function refundPayment(ctx: Ctx) {
  const { admin, body, caller } = ctx;
  const chargeId = String(body.chargeId ?? '');
  if (!chargeId) throw new HttpError('Missing chargeId');
  const note = String(body.note ?? '').trim().slice(0, 450);
  const reasonParam = String(body.reason ?? '');
  const reason = (REFUND_REASONS as readonly string[]).includes(reasonParam)
    ? (reasonParam as (typeof REFUND_REASONS)[number])
    : undefined;

  const charge = await stripe.charges.retrieve(chargeId);
  if (charge.status !== 'succeeded') throw new HttpError('Only a successful payment can be refunded.');
  const refundable = charge.amount - charge.amount_refunded;
  if (refundable <= 0) throw new HttpError('This payment has already been fully refunded.');

  const amount = body.amountCents == null ? refundable : Math.round(Number(body.amountCents));
  if (!Number.isFinite(amount) || amount < 1 || amount > refundable) {
    throw new HttpError(`Refund amount must be between 0.01 and ${(refundable / 100).toFixed(2)}.`);
  }

  const refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount,
      reason,
      metadata: { note, refunded_by: caller.email ?? '' },
    },
    // The modal sends one key per open, so a double-click can't refund twice.
    body.idempotencyKey ? { idempotencyKey: `founder-refund-${String(body.idempotencyKey)}` } : undefined,
  );

  const customerId = idOf(charge.customer);
  const account = customerId ? (await accountsByCustomer(admin, [customerId])).get(customerId) : undefined;
  const fullyRefunded = amount === refundable;
  const paymentIntentId = idOf(charge.payment_intent);
  if (fullyRefunded && paymentIntentId) {
    const { error } = await admin
      .from('payments')
      .update({ status: 'refunded' })
      .eq('stripe_payment_intent_id', paymentIntentId);
    if (error) console.warn('founder-billing: could not mark payment refunded', error);
  }

  await audit(ctx, 'refund_payment', account?.id ?? null, account?.name ?? charge.billing_details?.email ?? chargeId, note, {
    charge_id: chargeId,
    refund_id: refund.id,
    amount_cents: amount,
    currency: charge.currency,
    full: fullyRefunded,
    stripe_reason: reason ?? null,
  });

  return { refundId: refund.id, status: refund.status, amountCents: amount };
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

function subscriptionRow(sub: Stripe.Subscription) {
  const items = sub.items.data.map((item) => ({
    id: item.id,
    priceId: item.price?.id ?? null,
    tier: tierForPrice(item.price),
    amountCents: item.price?.unit_amount ?? 0,
    quantity: item.quantity ?? 1,
    interval: item.price?.recurring?.interval ?? null,
    currency: item.price?.currency ?? null,
  }));
  const coupon = sub.discount?.coupon;
  return {
    id: sub.id,
    status: sub.status,
    tier: items.map((i) => i.tier).find(Boolean) ?? null,
    kind: items.some((i) => i.tier) ? 'plan' : 'addon',
    items,
    created: sub.created * 1000,
    currentPeriodEnd: sub.current_period_end ? sub.current_period_end * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    cancelAt: sub.cancel_at ? sub.cancel_at * 1000 : null,
    canceledAt: sub.canceled_at ? sub.canceled_at * 1000 : null,
    endedAt: sub.ended_at ? sub.ended_at * 1000 : null,
    discount: coupon
      ? {
          name: coupon.name ?? coupon.id,
          percentOff: coupon.percent_off ?? null,
          amountOffCents: coupon.amount_off ?? null,
          duration: coupon.duration,
          endsAt: sub.discount?.end ? sub.discount.end * 1000 : null,
        }
      : null,
  };
}

async function accountSubscriptions({ admin, body }: Ctx) {
  const account = await accountById(admin, String(body.accountId ?? ''));
  if (!account.stripe_customer_id) return { customerId: null, balanceCents: 0, subscriptions: [] };
  // Stripe caps `expand` at 4 levels, and nothing here needs the product name
  // beyond the tier resolved from the price itself.
  const res = await stripe.subscriptions.list({
    customer: account.stripe_customer_id,
    status: 'all',
    limit: 30,
  });
  const customer = await stripe.customers.retrieve(account.stripe_customer_id);
  // A negative Stripe balance is credit the customer holds against future invoices.
  const balanceCents = customer.deleted ? 0 : -(customer.balance ?? 0);
  return { customerId: account.stripe_customer_id, balanceCents, subscriptions: res.data.map(subscriptionRow) };
}

/** A subscription that belongs to this account's customer — never trust a bare subscription id from the client. */
async function ownedSubscription(admin: SupabaseClient, accountId: string, subscriptionId: string) {
  const account = await accountById(admin, accountId);
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (!account.stripe_customer_id || idOf(sub.customer) !== account.stripe_customer_id) {
    throw new HttpError('That subscription does not belong to this account.', 403);
  }
  return { account, sub };
}

/** Product to hang an inline plan price on, reused across changes instead of one product per call. */
async function planProductId(tier: string): Promise<string> {
  const found = await stripe.products.search({ query: `metadata['tryouthq_tier']:'${tier}' AND active:'true'`, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const product = await stripe.products.create({
    name: `SquadOwl ${TIER_PRICES_CAD[tier].name}`,
    metadata: { tryouthq_tier: tier },
  });
  return product.id;
}

async function changePlan(ctx: Ctx) {
  const { admin, body } = ctx;
  const tier = String(body.tier ?? '');
  if (!TIER_PRICES_CAD[tier]) throw new HttpError('Choose Coach, Coach+ or Club.');
  const { account, sub } = await ownedSubscription(admin, String(body.accountId ?? ''), String(body.subscriptionId ?? ''));
  if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
    throw new HttpError(`A ${sub.status} subscription can't be changed.`);
  }

  const item = sub.items.data.find((i) => tierForPrice(i.price)) ?? sub.items.data[0];
  if (!item) throw new HttpError('This subscription has no items.');
  const fromTier = tierForPrice(item.price);
  if (fromTier === tier) throw new HttpError('The subscription is already on that plan.');
  const interval: 'year' | 'month' = item.price.recurring?.interval === 'month' ? 'month' : 'year';

  const priceId = configuredPriceId(tier, interval);
  // "none" by default: the founder is overriding billing by hand, so nothing is
  // charged or credited until the next renewal unless they ask for proration.
  const prorate = body.prorate === true;
  const updated = await stripe.subscriptions.update(sub.id, {
    items: [
      priceId
        ? { id: item.id, price: priceId }
        : {
            id: item.id,
            price_data: {
              currency: 'cad',
              product: await planProductId(tier),
              unit_amount: TIER_PRICES_CAD[tier][interval],
              recurring: { interval },
            },
          },
    ],
    proration_behavior: prorate ? 'create_prorations' : 'none',
    metadata: { ...sub.metadata, planTier: tier, changed_by_founder: 'true' },
  });

  await audit(ctx, 'change_subscription', account.id, account.name, strOrNull(body.note), {
    subscription_id: sub.id,
    from: fromTier,
    to: tier,
    interval,
    prorate,
  });
  return subscriptionRow(updated);
}

async function cancelSubscription(ctx: Ctx) {
  const { admin, body } = ctx;
  const { account, sub } = await ownedSubscription(admin, String(body.accountId ?? ''), String(body.subscriptionId ?? ''));
  if (['canceled', 'incomplete_expired'].includes(sub.status)) throw new HttpError('This subscription has already ended.');
  const immediately = body.when === 'now';
  const updated = immediately
    ? await stripe.subscriptions.cancel(sub.id, { prorate: false })
    : await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });

  await audit(ctx, 'cancel_subscription', account.id, account.name, strOrNull(body.note), {
    subscription_id: sub.id,
    tier: sub.items.data.map((i) => tierForPrice(i.price)).find(Boolean) ?? null,
    when: immediately ? 'now' : 'period_end',
  });
  return subscriptionRow(updated);
}

async function resumeSubscription(ctx: Ctx) {
  const { admin, body } = ctx;
  const { account, sub } = await ownedSubscription(admin, String(body.accountId ?? ''), String(body.subscriptionId ?? ''));
  if (!sub.cancel_at_period_end) throw new HttpError('This subscription is not scheduled to cancel.');
  const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
  await audit(ctx, 'resume_subscription', account.id, account.name, strOrNull(body.note), { subscription_id: sub.id });
  return subscriptionRow(updated);
}

/** Credit applied to the customer's next invoices (Stripe customer balance). */
async function addCredit(ctx: Ctx) {
  const { admin, body } = ctx;
  const account = await accountById(admin, String(body.accountId ?? ''));
  if (!account.stripe_customer_id) throw new HttpError('This account has no Stripe customer yet.');
  const amountCents = Math.round(Number(body.amountCents));
  if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 100000) {
    throw new HttpError('Credit must be between $1.00 and $1,000.00.');
  }
  const note = strOrNull(body.note);
  if (!note || !note.trim()) throw new HttpError('A note is required for credits.');
  const tx = await stripe.customers.createBalanceTransaction(
    account.stripe_customer_id,
    { amount: -amountCents, currency: 'cad', description: `Credit from founder console: ${note.trim()}`.slice(0, 350) },
    { idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined },
  );
  await audit(ctx, 'add_credit', account.id, account.name, note, { amount_cents: amountCents, currency: 'cad' });
  return { balanceCents: -tx.ending_balance, amountCents };
}

/**
 * Pushes the next charge back to a later date. Nothing is billed until then
 * (Stripe treats it as a free stretch before the next invoice); the date must
 * be after the current period ends and within a year.
 */
async function setBillingDate(ctx: Ctx) {
  const { admin, body } = ctx;
  const { account, sub } = await ownedSubscription(admin, String(body.accountId ?? ''), String(body.subscriptionId ?? ''));
  if (!['active', 'trialing'].includes(sub.status)) throw new HttpError('Only a live subscription can move its billing date.');
  const target = Date.parse(`${String(body.date ?? '')}T12:00:00Z`);
  if (!Number.isFinite(target)) throw new HttpError('Enter the new billing date.');
  const now = Date.now();
  const periodEnd = (sub.trial_end ?? sub.current_period_end ?? 0) * 1000;
  if (target <= Math.max(now, periodEnd)) throw new HttpError('The new date must be after the current billing date.');
  if (target > now + 366 * 24 * 60 * 60 * 1000) throw new HttpError('The new date must be within a year.');
  const updated = await stripe.subscriptions.update(sub.id, {
    trial_end: Math.floor(target / 1000),
    proration_behavior: 'none',
  });
  await audit(ctx, 'set_billing_date', account.id, account.name, strOrNull(body.note), {
    subscription_id: sub.id,
    from: periodEnd ? new Date(periodEnd).toISOString() : null,
    to: new Date(target).toISOString(),
  });
  return subscriptionRow(updated);
}

// ─── Revenue ────────────────────────────────────────────────────────────────

/** Hard stops so a runaway account can't make one dashboard load page through Stripe forever. */
const MAX_SUBSCRIPTIONS = 5000;
const MAX_CHARGES = 10000;

/**
 * Raw material for src/lib/revenue.ts: every subscription ever created (with
 * its monthly-normalised value) and succeeded charges per month. The series
 * themselves are computed client-side so the maths is unit-tested.
 */
async function revenueData({ body }: Ctx) {
  const months = Math.max(3, Math.min(36, Math.round(Number(body.months) || 12)));

  const subscriptions = [];
  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
    if (sub.status === 'incomplete' || sub.status === 'incomplete_expired') continue;
    let mrrCents = 0;
    let currency: string | null = null;
    let tier: string | null = null;
    for (const item of sub.items.data) {
      const price = item.price;
      const amount = (price.unit_amount ?? 0) * (item.quantity ?? 1);
      const count = price.recurring?.interval_count ?? 1;
      const perMonth =
        price.recurring?.interval === 'year'
          ? amount / (12 * count)
          : price.recurring?.interval === 'week'
            ? (amount * 52) / (12 * count)
            : price.recurring?.interval === 'day'
              ? (amount * 365) / (12 * count)
              : amount / count;
      mrrCents += perMonth;
      currency = currency ?? price.currency;
      tier = tier ?? tierForPrice(price);
    }
    // A lasting coupon lowers what the subscription is really worth each month;
    // a one-off first-invoice discount doesn't.
    const coupon = sub.discount?.coupon;
    if (coupon && coupon.duration !== 'once') {
      if (coupon.percent_off) mrrCents *= 1 - coupon.percent_off / 100;
      else if (coupon.amount_off) mrrCents = Math.max(0, mrrCents - coupon.amount_off);
    }
    subscriptions.push({
      id: sub.id,
      customerId: idOf(sub.customer),
      status: sub.status,
      tier,
      currency,
      mrrCents: Math.round(mrrCents),
      startedAt: (sub.start_date ?? sub.created) * 1000,
      trialEndsAt: sub.trial_end ? sub.trial_end * 1000 : null,
      endedAt: sub.ended_at ? sub.ended_at * 1000 : null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    });
    if (subscriptions.length >= MAX_SUBSCRIPTIONS) break;
  }

  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCMonth(since.getUTCMonth() - (months - 1));

  const charges: { month: string; currency: string; amountCents: number; refundedCents: number }[] = [];
  let seen = 0;
  for await (const c of stripe.charges.list({ limit: 100, created: { gte: Math.floor(since.getTime() / 1000) } })) {
    if (++seen > MAX_CHARGES) break;
    if (c.status !== 'succeeded') continue;
    charges.push({
      month: new Date(c.created * 1000).toISOString().slice(0, 7),
      currency: c.currency,
      amountCents: c.amount,
      refundedCents: c.amount_refunded,
    });
  }

  return {
    months,
    generatedAt: Date.now(),
    truncated: subscriptions.length >= MAX_SUBSCRIPTIONS || seen > MAX_CHARGES,
    subscriptions,
    charges,
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

const ACTIONS: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  list_payments: listPayments,
  get_payment: getPayment,
  refund: refundPayment,
  account_subscriptions: accountSubscriptions,
  change_plan: changePlan,
  cancel_subscription: cancelSubscription,
  resume_subscription: resumeSubscription,
  add_credit: addCredit,
  set_billing_date: setBillingDate,
  revenue: revenueData,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = await requireFounder(req);
    if ('response' in auth) return auth.response;
    if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'STRIPE_SECRET_KEY is not set for this project.' }, 500);

    const body = (await req.json().catch(() => ({}))) as Body;
    const handler = ACTIONS[String(body.action ?? '')];
    if (!handler) return json({ error: 'Unknown action' }, 400);

    return json(await handler({ ...auth, body }));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    // Stripe errors carry a customer-safe message (e.g. "Charge ch_… has already been refunded").
    const err = e as Stripe.errors.StripeError;
    if (err?.type?.startsWith?.('Stripe')) {
      console.error('founder-billing: stripe error', err.message);
      return json({ error: err.message }, err.statusCode && err.statusCode < 500 ? 400 : 502);
    }
    console.error('founder-billing failed', e);
    return json({ error: 'Something went wrong talking to Stripe.' }, 500);
  }
});
