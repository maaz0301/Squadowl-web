import { useConnectAccountStatusQuery } from '@/features/queries';
import { useUser } from '@/state/authStore';

/**
 * Whether this account can actually take payments, preferring live Stripe state
 * over the cached `accounts.stripe_connect_charges_enabled` column.
 *
 * That column only moves when the `account.updated` webhook fires (or on a
 * second tap of Connect), and Stripe drops that event silently on any signing
 * secret mismatch — so gating the UI on the cached flag alone left fully
 * onboarded coaches staring at "Connect with Stripe". connect-account-status
 * retrieves the real account from Stripe and heals the column as a side effect,
 * so treat it as the source of truth and fall back to the cached flag only
 * while it's in flight or unreachable.
 */
export function useConnectStatus() {
  const user = useUser();
  const cached = !!user?.connectChargesEnabled;
  const statusQuery = useConnectAccountStatusQuery();

  const live = statusQuery.data?.connected ? !!statusQuery.data.chargesEnabled : undefined;

  return {
    /** True when Stripe will accept charges for this account. */
    chargesEnabled: live ?? cached,
    /** A Stripe account exists but hasn't finished onboarding. */
    onboardingIncomplete: statusQuery.data?.connected === true && live === false,
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    refetch: statusQuery.refetch,
  };
}
