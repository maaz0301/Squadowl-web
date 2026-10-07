import type { DiscountCode, DiscountCodeInput } from '@/data/founder/types';
import { planLabel } from '../labels';

/** Stripe amounts are in the currency's minor unit; every currency SquadOwl has billed in uses cents. */
export function formatMoney(cents: number, currency = 'cad'): string {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 1000) / 10}%`;
}

export function errorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  return e instanceof Error ? e.message : fallback;
}

/** "20% off" / "$10.00 off" plus how long it lasts. */
export function discountLabel(d: Pick<DiscountCodeInput, 'kind' | 'percentOff' | 'amountOffCents' | 'duration' | 'durationMonths'>): string {
  const value = d.kind === 'percent' ? `${d.percentOff ?? 0}% off` : `${formatMoney(d.amountOffCents ?? 0)} off`;
  const duration =
    d.duration === 'forever'
      ? 'every payment'
      : d.duration === 'repeating'
        ? `for ${d.durationMonths} month${d.durationMonths === 1 ? '' : 's'}`
        : 'first payment';
  return `${value} ${duration}`;
}

export function discountTiersLabel(d: Pick<DiscountCode, 'planTiers'>): string {
  return d.planTiers.length ? d.planTiers.map((t) => planLabel(t)).join(', ') : 'All paid plans';
}

/** active | expired | used up | inactive, in the order they matter. */
export function discountState(d: DiscountCode, now = Date.now()): { label: string; variant: 'success' | 'default' | 'warning' } {
  if (!d.active) return { label: 'Inactive', variant: 'default' };
  if (d.expiresAt && d.expiresAt <= now) return { label: 'Expired', variant: 'warning' };
  if (d.maxUses && d.uses >= d.maxUses) return { label: 'Used up', variant: 'warning' };
  return { label: 'Active', variant: 'success' };
}

export const SUBSCRIPTION_STATUS_BADGE: Record<string, { label: string; variant: 'success' | 'info' | 'warning' | 'danger' | 'default' }> = {
  active: { label: 'Active', variant: 'success' },
  trialing: { label: 'Trialing', variant: 'info' },
  past_due: { label: 'Past due', variant: 'warning' },
  unpaid: { label: 'Unpaid', variant: 'danger' },
  canceled: { label: 'Cancelled', variant: 'default' },
  incomplete: { label: 'Incomplete', variant: 'warning' },
  incomplete_expired: { label: 'Expired', variant: 'default' },
  paused: { label: 'Paused', variant: 'default' },
  none: { label: 'No subscription', variant: 'default' },
};

export function subscriptionStatusBadge(status: string) {
  return SUBSCRIPTION_STATUS_BADGE[status] ?? { label: status, variant: 'default' as const };
}
