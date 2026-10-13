/**
 * Founder console — Billing & Revenue. founder@tryout.ca only.
 *
 * Discount codes and the subscription list are is_founder()-gated RPCs
 * (supabase/migrations/20260917130000_founder_billing.sql). Payments, refunds,
 * Stripe subscription changes and revenue data need the Stripe secret key, so
 * they go through the founder-billing edge function.
 */
import { getSupabase } from '@/lib/supabase';
import type { RevenueData } from '@/lib/revenue';
import { extractFunctionErrorMessage, toMs, type Row } from '../supabase/SupabaseDataSource';
import { founderError } from './errors';
import type {
  BillingPaymentDetail,
  BillingPaymentPage,
  DiscountCode,
  DiscountCodeInput,
  DiscountRedemption,
  FounderSubscriptionFilter,
  FounderSubscriptionPage,
  PaidPlanTier,
  PaymentFilter,
  RefundReason,
  StripeSubscription,
  SubscriptionTierCount,
} from './types';

const num = (v: unknown) => Number(v ?? 0) || 0;
const optMs = (v: unknown) => (v ? toMs(v as string) : undefined);

/** Same as founderError(), naming this migration when it isn't applied. */
function billingError(error: { message: string; code?: string }) {
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01') {
    return founderError({
      ...error,
      code: undefined,
      message: 'Billing is not deployed yet — apply 20260917130000_founder_billing.sql.',
    });
  }
  return founderError(error);
}

async function invokeBilling<T>(action: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('founder-billing', { body: { action, ...body } });
  if (error) throw new Error(await extractFunctionErrorMessage(error, fallback));
  if (data?.error) throw new Error(data.error);
  return data as T;
}

// ─── Discount codes ─────────────────────────────────────────────────────────

export async function listDiscountCodes(): Promise<DiscountCode[]> {
  const { data, error } = await getSupabase().rpc('founder_list_discount_codes');
  if (error) throw billingError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description ?? undefined,
    kind: r.kind,
    percentOff: r.percent_off != null ? Number(r.percent_off) : undefined,
    amountOffCents: r.amount_off_cents ?? undefined,
    duration: r.duration,
    durationMonths: r.duration_months ?? undefined,
    maxUses: r.max_uses ?? undefined,
    maxUsesPerAccount: r.max_uses_per_account ?? undefined,
    planTiers: (r.plan_tiers ?? []) as PaidPlanTier[],
    expiresAt: optMs(r.expires_at),
    active: !!r.active,
    createdAt: toMs(r.created_at),
    uses: num(r.uses),
    accountsUsed: num(r.accounts_used),
    discountTotalCents: num(r.discount_total_cents),
    lastUsedAt: optMs(r.last_used_at),
  }));
}

export async function saveDiscountCode(id: string | null, input: DiscountCodeInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('founder_save_discount_code', {
    p_id: id,
    p_code: input.code,
    p_description: input.description ?? null,
    p_kind: input.kind,
    p_percent_off: input.kind === 'percent' ? (input.percentOff ?? null) : null,
    p_amount_off_cents: input.kind === 'amount' ? (input.amountOffCents ?? null) : null,
    p_duration: input.duration,
    p_duration_months: input.duration === 'repeating' ? (input.durationMonths ?? null) : null,
    p_max_uses: input.maxUses ?? null,
    p_max_uses_per_account: input.maxUsesPerAccount ?? null,
    p_plan_tiers: input.planTiers.length ? input.planTiers : null,
    p_expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    p_active: input.active,
  });
  if (error) throw billingError(error);
  return data as string;
}

export async function listDiscountRedemptions(codeId: string): Promise<DiscountRedemption[]> {
  const { data, error } = await getSupabase().rpc('founder_list_discount_redemptions', { p_code_id: codeId });
  if (error) throw billingError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    accountId: r.account_id ?? undefined,
    accountName: r.account_name ?? undefined,
    ownerEmail: r.owner_email ?? undefined,
    checkoutSessionId: r.checkout_session_id,
    planTier: r.plan_tier ?? undefined,
    discountCents: num(r.discount_cents),
    createdAt: toMs(r.created_at),
  }));
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

export async function listSubscriptions(filter: FounderSubscriptionFilter): Promise<FounderSubscriptionPage> {
  const { data, error } = await getSupabase().rpc('founder_list_subscriptions', {
    p_search: filter.search ?? null,
    p_tier: filter.tier ?? null,
    p_billing: filter.billing ?? null,
    p_limit: filter.limit,
    p_offset: filter.offset,
  });
  if (error) throw billingError(error);
  const rows = (data ?? []) as Row[];
  return {
    total: rows.length ? num(rows[0].total_count) : 0,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountType: r.account_type,
      planTier: r.plan_tier,
      subscriptionStatus: r.subscription_status,
      accessStatus: r.access_status,
      isComp: !!r.is_comp,
      trialEndsAt: optMs(r.trial_ends_at),
      stripeCustomerId: r.stripe_customer_id ?? undefined,
      stripeSubscriptionId: r.stripe_subscription_id ?? undefined,
      subscriptionCancelAt: optMs(r.subscription_cancel_at),
      pendingPlanTier: r.pending_plan_tier ?? undefined,
      pendingPlanChangeAt: optMs(r.pending_plan_change_at),
      extraTeamLicenses: num(r.extra_team_licenses),
      firstPaidAt: optMs(r.first_paid_at),
      ownerEmail: r.owner_email ?? undefined,
      createdAt: toMs(r.created_at),
    })),
  };
}

export async function getSubscriptionCounts(): Promise<SubscriptionTierCount[]> {
  const { data, error } = await getSupabase().rpc('founder_subscription_counts');
  if (error) throw billingError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    planTier: r.plan_tier,
    accounts: num(r.accounts),
    paying: num(r.paying),
    comp: num(r.comp),
    trial: num(r.trial),
    pastDue: num(r.past_due),
    canceling: num(r.canceling),
  }));
}

export function getAccountStripeSubscriptions(
  accountId: string,
): Promise<{ customerId: string | null; balanceCents?: number; subscriptions: StripeSubscription[] }> {
  return invokeBilling('account_subscriptions', { accountId }, 'Could not load Stripe subscriptions');
}

export function changeStripePlan(input: {
  accountId: string;
  subscriptionId: string;
  tier: PaidPlanTier;
  prorate: boolean;
  note?: string;
}): Promise<StripeSubscription> {
  return invokeBilling('change_plan', input, 'Could not change the plan');
}

export function cancelStripeSubscription(input: {
  accountId: string;
  subscriptionId: string;
  when: 'period_end' | 'now';
  note?: string;
}): Promise<StripeSubscription> {
  return invokeBilling('cancel_subscription', input, 'Could not cancel the subscription');
}

export function resumeStripeSubscription(input: {
  accountId: string;
  subscriptionId: string;
  note?: string;
}): Promise<StripeSubscription> {
  return invokeBilling('resume_subscription', input, 'Could not resume the subscription');
}

export function addAccountCredit(input: {
  accountId: string;
  amountCents: number;
  note: string;
  idempotencyKey: string;
}): Promise<{ balanceCents: number; amountCents: number }> {
  return invokeBilling('add_credit', input, 'Could not add the credit');
}

export function setSubscriptionBillingDate(input: {
  accountId: string;
  subscriptionId: string;
  /** yyyy-mm-dd */
  date: string;
  note?: string;
}): Promise<StripeSubscription> {
  return invokeBilling('set_billing_date', input, 'Could not change the billing date');
}

// ─── Payments & refunds ─────────────────────────────────────────────────────

export function listPayments(filter: PaymentFilter, cursor?: string): Promise<BillingPaymentPage> {
  return invokeBilling('list_payments', { ...filter, cursor }, 'Could not load payments');
}

export function getPayment(chargeId: string): Promise<BillingPaymentDetail> {
  return invokeBilling('get_payment', { chargeId }, 'Could not load this payment');
}

export function refundPayment(input: {
  chargeId: string;
  /** Omit for a full refund of whatever is left. */
  amountCents?: number;
  reason?: RefundReason;
  note: string;
  idempotencyKey: string;
}): Promise<{ refundId: string; status: string; amountCents: number }> {
  return invokeBilling('refund', input, 'Could not refund this payment');
}

// ─── Revenue ────────────────────────────────────────────────────────────────

export function getRevenueData(months: number): Promise<RevenueData> {
  return invokeBilling('revenue', { months }, 'Could not load revenue');
}
