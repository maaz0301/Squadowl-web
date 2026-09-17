import Stripe from 'npm:stripe@14.21.0';

/** Same client setup as the functions repo's _shared/stripe.ts (Athlete-Assessment). */
export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

/** free < coach < coach_plus < club — mirrors TIER_ORDER in src/data/plans.ts. */
export const TIER_ORDER = ['free', 'coach', 'coach_plus', 'club'];

/**
 * Mirrors TIER_PRICES_CAD in create-checkout-session / stripe-webhook and
 * PLAN_DEFINITIONS in src/data/plans.ts.
 */
export const TIER_PRICES_CAD: Record<string, { name: string; year: number; month: number }> = {
  coach: { name: 'Coach Plan', year: 3999, month: 400 },
  coach_plus: { name: 'Coach+ Plan', year: 6999, month: 700 },
  club: { name: 'Club Plan', year: 9999, month: 1000 },
};

function envPriceId(key: string): string | null {
  const id = Deno.env.get(key);
  return id && id.trim() !== '' && id !== 'undefined' && id !== 'null' ? id.trim() : null;
}

/** The configured Dashboard price for a tier/interval, if any (STRIPE_PRICE_ID_<TIER>_<YEARLY|MONTHLY>). */
export function configuredPriceId(tier: string, interval: 'year' | 'month'): string | null {
  return envPriceId(`STRIPE_PRICE_ID_${tier.toUpperCase()}_${interval === 'year' ? 'YEARLY' : 'MONTHLY'}`);
}

/**
 * Plan tier for a Stripe price, or null for anything that isn't a plan (team
 * licenses, retired prices). Same resolution as stripe-webhook: configured
 * price ids first, then the hardcoded CAD amount.
 */
export function tierForPrice(price: Stripe.Price | null | undefined): string | null {
  if (!price) return null;
  for (const tier of Object.keys(TIER_PRICES_CAD)) {
    if (price.id === configuredPriceId(tier, 'year') || price.id === configuredPriceId(tier, 'month')) return tier;
  }
  if (price.id === envPriceId('STRIPE_PRICE_ID_TEAM_LICENSE_YEARLY')) return null;
  if (price.unit_amount == null || price.currency?.toLowerCase() !== 'cad') return null;
  const interval = price.recurring?.interval;
  if (interval !== 'year' && interval !== 'month') return null;
  for (const [tier, prices] of Object.entries(TIER_PRICES_CAD)) {
    if (prices[interval] === price.unit_amount) return tier;
  }
  return null;
}
