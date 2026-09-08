-- When a scheduled cancellation actually takes effect.
--
-- Cancelling in the Stripe Customer Portal is configured `at_period_end`, so
-- the subscription stays `active` — and the account keeps the tier it paid for
-- — right up until the period ends. That is the intended behaviour, but the app
-- had no way to say so: a cancelled account looked identical to a renewing one,
-- which reads as "I cancelled and nothing happened."
--
-- Null means no cancellation is scheduled. The value is Stripe's `cancel_at` on
-- the subscription backing the account's tier, written by stripe-webhook, and
-- cleared again if the customer changes their mind ("Don't cancel subscription"
-- in the portal).
alter table public.accounts
  add column if not exists subscription_cancel_at timestamptz;

comment on column public.accounts.subscription_cancel_at is
  'When the current subscription is scheduled to end, for portal cancellations taken at period end. Null when the subscription renews normally.';
