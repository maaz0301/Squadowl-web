-- A plan change that is scheduled but has not happened yet.
--
-- The billing portal defers downgrades to the end of the paid term: choosing a
-- lower tier attaches a Stripe subscription schedule and leaves the current
-- price running until renewal. Nothing on the subscription itself changes, so
-- without recording the schedule's next phase the app shows no trace of the
-- downgrade at all — the same "I chose it and nothing happened" that the
-- at-period-end cancellation had before subscription_cancel_at existed.
--
-- Both null when no change is scheduled. Written by stripe-webhook from the
-- schedule attached to whichever subscription backs the account's tier, and
-- cleared when the schedule is released or the phase takes effect.
alter table public.accounts
  add column if not exists pending_plan_tier text,
  add column if not exists pending_plan_change_at timestamptz;

comment on column public.accounts.pending_plan_tier is
  'Tier this account is scheduled to move to at pending_plan_change_at, for downgrades deferred to the end of the paid term. Null when no change is scheduled.';

comment on column public.accounts.pending_plan_change_at is
  'When pending_plan_tier takes effect. Null when no change is scheduled.';
