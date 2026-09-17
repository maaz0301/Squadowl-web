-- Founder console: Billing & Revenue.
--
-- What lives where:
--   * Discount codes are ours, not Stripe promotion codes. Stripe's promotion
--     codes can't express "once per organization" or "only on the Club plan"
--     for our checkout, which builds inline price_data (a new Stripe product
--     per session) whenever no STRIPE_PRICE_ID_* is configured. So the code,
--     its limits and its redemptions are tables here; create-checkout-session
--     validates the code with check_discount_code() and turns it into a
--     one-off Stripe coupon, and stripe-webhook records the redemption with
--     record_discount_redemption() once the checkout actually completes.
--   * Payments, refunds, subscription changes and revenue are read from and
--     written to Stripe directly by the founder-billing edge function. Nothing
--     is mirrored, so there is no backfill and nothing to drift.
--   * Subscription list / tier counts below are plain RPCs over `accounts`.

-- ---------------------------------------------------------------------------
-- Audit actions
-- ---------------------------------------------------------------------------

alter table public.founder_audit_log
  drop constraint if exists founder_audit_log_action_check;

alter table public.founder_audit_log
  add constraint founder_audit_log_action_check
  check (action in (
    'suspend', 'reactivate', 'create_org', 'update_access',
    'impersonate_start', 'impersonate_end',
    'update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user',
    'create_announcement', 'end_announcement', 'broadcast_email',
    'create_discount_code', 'update_discount_code',
    'refund_payment', 'change_subscription', 'cancel_subscription', 'resume_subscription'
  ));

-- ---------------------------------------------------------------------------
-- Discount codes
-- ---------------------------------------------------------------------------

create table if not exists public.discount_codes (
  id                    uuid primary key default gen_random_uuid(),
  -- Stored upper-case; customers type it in any case.
  code                  text not null unique check (code ~ '^[A-Z0-9_-]{3,40}$'),
  description           text,
  kind                  text not null check (kind in ('percent', 'amount')),
  percent_off           numeric(5, 2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off_cents      int check (amount_off_cents is null or amount_off_cents > 0),
  -- Stripe coupon duration: first payment only, every payment, or N months.
  duration              text not null default 'once' check (duration in ('once', 'forever', 'repeating')),
  duration_months       int check (duration_months is null or duration_months between 1 and 36),
  -- null = unlimited.
  max_uses              int check (max_uses is null or max_uses > 0),
  max_uses_per_account  int check (max_uses_per_account is null or max_uses_per_account > 0),
  -- null / empty = every paid tier.
  plan_tiers            text[],
  expires_at            timestamptz,
  active                boolean not null default true,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint discount_codes_value_matches_kind check (
    (kind = 'percent' and percent_off is not null and amount_off_cents is null)
    or (kind = 'amount' and amount_off_cents is not null and percent_off is null)
  ),
  constraint discount_codes_months_match_duration check (
    (duration = 'repeating') = (duration_months is not null)
  )
);

create table if not exists public.discount_code_redemptions (
  id                   uuid primary key default gen_random_uuid(),
  code_id              uuid not null references public.discount_codes(id) on delete cascade,
  account_id           uuid references public.accounts(id) on delete set null,
  -- One redemption per completed checkout; also what makes the webhook idempotent.
  checkout_session_id  text not null unique,
  plan_tier            text,
  discount_cents       int not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists discount_code_redemptions_code_idx
  on public.discount_code_redemptions (code_id, account_id);

alter table public.discount_codes enable row level security;
alter table public.discount_code_redemptions enable row level security;

-- Founder reads both directly; nobody writes except the definer functions below
-- (and the service role, which bypasses RLS). Customers never read the tables —
-- preview_discount_code() tells them only about the code they typed.
drop policy if exists discount_codes_founder_read on public.discount_codes;
create policy discount_codes_founder_read on public.discount_codes
  for select using (public.is_founder());

drop policy if exists discount_code_redemptions_founder_read on public.discount_code_redemptions;
create policy discount_code_redemptions_founder_read on public.discount_code_redemptions
  for select using (public.is_founder());

-- Every code with its usage.
create or replace function public.founder_list_discount_codes()
returns table (
  id                   uuid,
  code                 text,
  description          text,
  kind                 text,
  percent_off          numeric,
  amount_off_cents     int,
  duration             text,
  duration_months      int,
  max_uses             int,
  max_uses_per_account int,
  plan_tiers           text[],
  expires_at           timestamptz,
  active               boolean,
  created_at           timestamptz,
  uses                 int,
  accounts_used        int,
  discount_total_cents bigint,
  last_used_at         timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select d.id, d.code, d.description, d.kind, d.percent_off, d.amount_off_cents,
         d.duration, d.duration_months, d.max_uses, d.max_uses_per_account,
         d.plan_tiers, d.expires_at, d.active, d.created_at,
         coalesce(r.uses, 0)::int,
         coalesce(r.accounts_used, 0)::int,
         coalesce(r.total, 0)::bigint,
         r.last_used_at
    from public.discount_codes d
    left join lateral (
      select count(*) as uses,
             count(distinct x.account_id) as accounts_used,
             sum(x.discount_cents) as total,
             max(x.created_at) as last_used_at
        from public.discount_code_redemptions x
       where x.code_id = d.id
    ) r on true
   order by d.active desc, d.created_at desc;
end;
$$;

grant execute on function public.founder_list_discount_codes() to authenticated;

-- Who used one code.
create or replace function public.founder_list_discount_redemptions(p_code_id uuid)
returns table (
  id                  uuid,
  account_id          uuid,
  account_name        text,
  owner_email         text,
  checkout_session_id text,
  plan_tier           text,
  discount_cents      int,
  created_at          timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select x.id, x.account_id, a.name, o.email::text, x.checkout_session_id, x.plan_tier, x.discount_cents, x.created_at
    from public.discount_code_redemptions x
    left join public.accounts a on a.id = x.account_id
    left join lateral (
      select p.email
        from public.memberships m
        join public.profiles p on p.id = m.user_id
       where m.account_id = x.account_id and m.role = 'owner'
       order by m.created_at
       limit 1
    ) o on true
   where x.code_id = p_code_id
   order by x.created_at desc;
end;
$$;

grant execute on function public.founder_list_discount_redemptions(uuid) to authenticated;

-- Create (p_id null) or edit a code. The code text, kind and value are frozen
-- once anyone has redeemed it, so the redemption history keeps meaning what it
-- said; limits, expiry, tiers, description and active can always change.
create or replace function public.founder_save_discount_code(
  p_id                   uuid,
  p_code                 text,
  p_description          text,
  p_kind                 text,
  p_percent_off          numeric,
  p_amount_off_cents     int,
  p_duration             text,
  p_duration_months      int,
  p_max_uses             int,
  p_max_uses_per_account int,
  p_plan_tiers           text[],
  p_expires_at           timestamptz,
  p_active               boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_code  text := upper(trim(coalesce(p_code, '')));
  v_tiers text[] := case when coalesce(array_length(p_plan_tiers, 1), 0) = 0 then null else p_plan_tiers end;
  v_used  int;
  prev    public.discount_codes;
  saved   public.discount_codes;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9_-]{3,40}$' then
    raise exception 'Code must be 3–40 letters, numbers, dashes or underscores' using errcode = '22023';
  end if;
  if v_tiers is not null and not v_tiers <@ array['coach', 'coach_plus', 'club']::text[] then
    raise exception 'Plan tiers must be coach, coach_plus or club' using errcode = '22023';
  end if;

  if p_id is null then
    begin
      insert into public.discount_codes (
        code, description, kind, percent_off, amount_off_cents, duration, duration_months,
        max_uses, max_uses_per_account, plan_tiers, expires_at, active, created_by)
      values (
        v_code, nullif(trim(p_description), ''), p_kind,
        case when p_kind = 'percent' then p_percent_off end,
        case when p_kind = 'amount' then p_amount_off_cents end,
        p_duration, case when p_duration = 'repeating' then p_duration_months end,
        p_max_uses, p_max_uses_per_account, v_tiers, p_expires_at, coalesce(p_active, true), auth.uid())
      returning * into saved;
    exception when unique_violation then
      raise exception 'A code named % already exists', v_code using errcode = '23505';
    end;

    perform public.founder_write_audit('create_discount_code', null, saved.code, null,
      to_jsonb(saved) - 'created_by');
    return saved.id;
  end if;

  select * into prev from public.discount_codes where id = p_id for update;
  if not found then
    raise exception 'Discount code not found' using errcode = 'P0002';
  end if;

  select count(*) into v_used from public.discount_code_redemptions where code_id = p_id;
  if v_used > 0 and (
       v_code <> prev.code
    or p_kind <> prev.kind
    or (p_kind = 'percent' and p_percent_off is distinct from prev.percent_off)
    or (p_kind = 'amount' and p_amount_off_cents is distinct from prev.amount_off_cents)
    or p_duration <> prev.duration
    or (p_duration = 'repeating' and p_duration_months is distinct from prev.duration_months)
  ) then
    raise exception 'This code has been used, so its name and discount can''t change. Deactivate it and create a new one.'
      using errcode = '22023';
  end if;

  begin
    update public.discount_codes
       set code                 = v_code,
           description          = nullif(trim(p_description), ''),
           kind                 = p_kind,
           percent_off          = case when p_kind = 'percent' then p_percent_off end,
           amount_off_cents     = case when p_kind = 'amount' then p_amount_off_cents end,
           duration             = p_duration,
           duration_months      = case when p_duration = 'repeating' then p_duration_months end,
           max_uses             = p_max_uses,
           max_uses_per_account = p_max_uses_per_account,
           plan_tiers           = v_tiers,
           expires_at           = p_expires_at,
           active               = coalesce(p_active, prev.active),
           updated_at           = now()
     where id = p_id
    returning * into saved;
  exception when unique_violation then
    raise exception 'A code named % already exists', v_code using errcode = '23505';
  end;

  perform public.founder_write_audit('update_discount_code', null, saved.code, null,
    jsonb_build_object('before', to_jsonb(prev) - 'created_by', 'after', to_jsonb(saved) - 'created_by'));
  return saved.id;
end;
$$;

grant execute on function public.founder_save_discount_code(
  uuid, text, text, text, numeric, int, text, int, int, int, text[], timestamptz, boolean) to authenticated;

-- Whether p_code can be used by p_account_id on p_plan_tier right now.
-- Limits count completed checkouts only (redemptions are recorded by the
-- webhook), so two checkouts opened at the same moment can both pass the last
-- use — acceptable for promo codes, and far better than burning a use on an
-- abandoned checkout.
create or replace function public.check_discount_code(p_code text, p_plan_tier text, p_account_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  d public.discount_codes;
  v_uses int;
  v_account_uses int;
begin
  select * into d from public.discount_codes where code = upper(trim(coalesce(p_code, '')));
  if not found or not d.active then
    return json_build_object('valid', false, 'message', 'That discount code isn''t valid.');
  end if;
  if d.expires_at is not null and d.expires_at <= now() then
    return json_build_object('valid', false, 'message', 'That discount code has expired.');
  end if;
  if d.plan_tiers is not null and not (coalesce(p_plan_tier, '') = any(d.plan_tiers)) then
    return json_build_object('valid', false, 'message', 'That discount code doesn''t apply to this plan.');
  end if;

  select count(*), count(*) filter (where account_id = p_account_id)
    into v_uses, v_account_uses
    from public.discount_code_redemptions
   where code_id = d.id;

  if d.max_uses is not null and v_uses >= d.max_uses then
    return json_build_object('valid', false, 'message', 'That discount code has been fully redeemed.');
  end if;
  if d.max_uses_per_account is not null and p_account_id is not null and v_account_uses >= d.max_uses_per_account then
    return json_build_object('valid', false, 'message', 'Your organization has already used that discount code.');
  end if;

  return json_build_object(
    'valid', true,
    'id', d.id,
    'code', d.code,
    'kind', d.kind,
    'percentOff', d.percent_off,
    'amountOffCents', d.amount_off_cents,
    'duration', d.duration,
    'durationMonths', d.duration_months,
    'planTiers', d.plan_tiers);
end;
$$;

-- Service role only (create-checkout-session).
revoke all on function public.check_discount_code(text, text, uuid) from public, anon, authenticated;

-- The customer-facing preview on the Upgrade page. Resolves the caller's
-- account the same way create-checkout-session does (oldest membership), so
-- the answer matches what checkout will decide.
create or replace function public.preview_discount_code(p_code text, p_plan_tier text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_account uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select m.account_id into v_account
    from public.memberships m
   where m.user_id = auth.uid()
   order by m.created_at
   limit 1;
  return public.check_discount_code(p_code, p_plan_tier, v_account);
end;
$$;

grant execute on function public.preview_discount_code(text, text) to authenticated;

-- Called by stripe-webhook on checkout.session.completed. Returns the new
-- redemption id, or null if this session was already recorded.
create or replace function public.record_discount_redemption(
  p_code_id uuid, p_account_id uuid, p_session_id text, p_plan_tier text, p_discount_cents int
) returns uuid language sql security definer set search_path = public as $$
  insert into public.discount_code_redemptions (code_id, account_id, checkout_session_id, plan_tier, discount_cents)
  values (p_code_id, p_account_id, p_session_id, p_plan_tier, greatest(0, coalesce(p_discount_cents, 0)))
  on conflict (checkout_session_id) do nothing
  returning id;
$$;

revoke all on function public.record_discount_redemption(uuid, uuid, text, text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

-- Every account (organizations and individual coaches both pay), filtered by
-- tier and billing state. p_billing: null | 'paying' | 'comp' | 'trial' |
-- 'free' | 'past_due' | 'canceling'.
create or replace function public.founder_list_subscriptions(
  p_search  text default null,
  p_tier    text default null,
  p_billing text default null,
  p_limit   int default 50,
  p_offset  int default 0
) returns table (
  id                     uuid,
  name                   text,
  account_type           text,
  plan_tier              text,
  subscription_status    text,
  access_status          text,
  is_comp                boolean,
  trial_ends_at          timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_cancel_at timestamptz,
  pending_plan_tier      text,
  pending_plan_change_at timestamptz,
  extra_team_licenses    int,
  first_paid_at          timestamptz,
  owner_email            text,
  created_at             timestamptz,
  total_count            bigint
) language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select a.*, public.account_access_status(a) as status,
           (a.subscription_status::text in ('active', 'trialing', 'past_due') and a.stripe_subscription_id is not null) as paying
      from public.accounts a
     where (p_tier is null or a.plan_tier::text = p_tier)
       and (q is null
            or a.name ilike '%' || q || '%'
            or a.stripe_customer_id = q
            or exists (select 1
                         from public.memberships m
                         join public.profiles p on p.id = m.user_id
                        where m.account_id = a.id
                          and m.role = 'owner'
                          and p.email ilike '%' || q || '%'))
  ),
  page as (
    select f.*, count(*) over () as total
      from filtered f
     where case p_billing
             when 'paying'    then f.paying
             when 'comp'      then f.is_comp
             when 'trial'     then f.status = 'trial'
             when 'free'      then f.plan_tier::text = 'free' and not f.is_comp
             when 'past_due'  then f.subscription_status::text = 'past_due'
             when 'canceling' then f.subscription_cancel_at is not null
             else true
           end
     order by f.paying desc, f.created_at desc, f.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id, pg.name, pg.type::text, pg.plan_tier::text, pg.subscription_status::text, pg.status,
         pg.is_comp, pg.trial_ends_at, pg.stripe_customer_id, pg.stripe_subscription_id,
         pg.subscription_cancel_at, pg.pending_plan_tier, pg.pending_plan_change_at,
         coalesce(pg.extra_team_licenses, 0), pg.first_paid_at, o.email::text, pg.created_at, pg.total
    from page pg
    left join lateral (
      select p.email
        from public.memberships m
        join public.profiles p on p.id = m.user_id
       where m.account_id = pg.id and m.role = 'owner'
       order by m.created_at
       limit 1
    ) o on true
   order by pg.paying desc, pg.created_at desc, pg.id;
end;
$$;

grant execute on function public.founder_list_subscriptions(text, text, text, int, int) to authenticated;

-- Headline counts per tier for the Subscriptions tab.
create or replace function public.founder_subscription_counts()
returns table (
  plan_tier text,
  accounts  int,
  paying    int,
  comp      int,
  trial     int,
  past_due  int,
  canceling int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select a.plan_tier::text,
         count(*)::int,
         count(*) filter (where a.subscription_status::text in ('active', 'trialing', 'past_due')
                            and a.stripe_subscription_id is not null)::int,
         count(*) filter (where a.is_comp)::int,
         count(*) filter (where public.account_access_status(a) = 'trial')::int,
         count(*) filter (where a.subscription_status::text = 'past_due')::int,
         count(*) filter (where a.subscription_cancel_at is not null)::int
    from public.accounts a
   group by a.plan_tier
   order by a.plan_tier;
end;
$$;

grant execute on function public.founder_subscription_counts() to authenticated;
