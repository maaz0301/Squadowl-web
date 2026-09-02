-- Loyalty / referral program.
--
-- Every subscriber account gets a unique 9-character alphanumeric referral
-- code. When someone signs up, enters that code, and then converts to a paid
-- plan, the referrer earns CAD$1 of account credit, capped at CAD$60 per
-- rolling 365 days. The balance is drawn down at checkout as a one-off Stripe
-- coupon on the first invoice.
--
-- Money lives in a ledger (`referral_credits`) rather than a running balance
-- column on `accounts`: the balance is sum(amount_cents), so a concurrent award
-- and redemption can't read-then-write over each other the way a counter would,
-- and the profile screen can show the customer where each dollar came from.
--
-- All writes go through SECURITY DEFINER functions. Nothing outside them may
-- insert into the ledger — the table's only policy is a read for the account's
-- own members — so a client cannot mint itself credit by writing a row.

-- ---------------------------------------------------------------------------
-- Columns on accounts
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column if not exists referral_code text;

alter table public.accounts
  add column if not exists referred_by_account_id uuid references public.accounts(id) on delete set null;

alter table public.accounts
  add column if not exists referral_attributed_at timestamptz;

-- Codes are handed out to customers to type, so uniqueness is enforced here and
-- the generator retries on conflict rather than trusting a random draw.
create unique index if not exists accounts_referral_code_key
  on public.accounts (referral_code)
  where referral_code is not null;

create index if not exists accounts_referred_by_idx
  on public.accounts (referred_by_account_id)
  where referred_by_account_id is not null;

comment on column public.accounts.referral_code is
  'Unique 9-character code this account shares to refer new subscribers.';
comment on column public.accounts.referred_by_account_id is
  'The account whose referral code this account signed up with (set once, never reassigned).';

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

create table if not exists public.referral_credits (
  id                  uuid primary key default gen_random_uuid(),
  -- The account the money belongs to: the referrer on 'earned', the payer on
  -- 'redeemed'.
  account_id          uuid not null references public.accounts(id) on delete cascade,
  kind                text not null check (kind in ('earned', 'redeemed', 'adjustment')),
  -- Positive credits the account, negative debits it. Balance is the sum, so a
  -- redemption is stored as a negative number rather than a separate column.
  amount_cents        integer not null check (amount_cents <> 0),
  -- On 'earned', the account whose conversion triggered the credit.
  referred_account_id uuid references public.accounts(id) on delete set null,
  -- The Stripe checkout session that caused this entry, for idempotency against
  -- redelivered webhooks (Stripe retries on any non-2xx and can double-deliver).
  stripe_session_id   text,
  note                text,
  created_at          timestamptz not null default now()
);

create index if not exists referral_credits_account_idx
  on public.referral_credits (account_id, created_at desc);

-- One entry per (session, kind). A single checkout can legitimately produce both
-- an 'earned' row for the referrer and a 'redeemed' row for the payer, so the
-- kind is part of the key.
create unique index if not exists referral_credits_session_kind_key
  on public.referral_credits (stripe_session_id, kind)
  where stripe_session_id is not null;

-- A referral pays out once per referred account, ever — not on every renewal
-- that account goes on to pay for.
create unique index if not exists referral_credits_earned_once_per_referral
  on public.referral_credits (referred_account_id)
  where kind = 'earned' and referred_account_id is not null;

alter table public.referral_credits enable row level security;

-- Members can read their own account's ledger. There is deliberately no write
-- policy: every insert happens inside the SECURITY DEFINER functions below.
drop policy if exists referral_credits_read on public.referral_credits;
create policy referral_credits_read on public.referral_credits
  for select using (public.has_account_access(account_id));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- CAD$60 per rolling 365 days, per the program terms.
create or replace function public.referral_annual_cap_cents()
returns integer language sql immutable as $$ select 6000 $$;

-- Resolves the caller's tenant account the same way the app's ctx() does: the
-- oldest membership wins. Named with a `referral_` prefix rather than a generic
-- `current_account_id` so a `create or replace` here can't quietly rewrite a
-- same-named function that lives in the shared backend repo.
create or replace function public.referral_caller_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.account_id
    from public.memberships m
   where m.user_id = auth.uid()
   order by m.created_at asc
   limit 1;
$$;

create or replace function public.referral_balance_cents(p_account_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_cents), 0)::integer
    from public.referral_credits
   where account_id = p_account_id;
$$;

-- Only 'earned' rows count against the cap; spending credit does not free up
-- headroom to earn more this year.
create or replace function public.referral_earned_last_year_cents(p_account_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_cents), 0)::integer
    from public.referral_credits
   where account_id = p_account_id
     and kind = 'earned'
     and created_at > now() - interval '365 days';
$$;

-- 9 characters from an alphabet with O/0, I/1 and L removed — these get read
-- aloud and re-typed by the person receiving them, so the ambiguous glyphs cost
-- more in support than the extra entropy is worth.
create or replace function public.referral_random_code()
returns text language plpgsql volatile as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i integer;
begin
  for i in 1..9 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Caller-facing API
-- ---------------------------------------------------------------------------

-- Returns the caller's referral code, minting one on first call. Codes are
-- generated lazily instead of backfilled so accounts that never open the
-- loyalty screen don't consume the namespace.
create or replace function public.ensure_referral_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_account_id uuid := public.referral_caller_account_id();
  v_code text;
  v_attempt integer := 0;
begin
  if v_account_id is null then
    raise exception 'No account found for the current user' using errcode = 'P0002';
  end if;

  select referral_code into v_code from public.accounts where id = v_account_id;
  if v_code is not null then
    return v_code;
  end if;

  -- 31^9 keys against a customer-count that fits in an integer, so a collision
  -- is remote — but the unique index is the authority, not the odds.
  loop
    v_attempt := v_attempt + 1;
    v_code := public.referral_random_code();
    begin
      update public.accounts set referral_code = v_code where id = v_account_id;
      return v_code;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not allocate a referral code, please try again';
      end if;
    end;
  end loop;
end;
$$;

-- Everything the loyalty screen renders, in one round trip.
create or replace function public.get_referral_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_account_id uuid := public.referral_caller_account_id();
  v_code text;
  v_referred_by text;
begin
  if v_account_id is null then
    raise exception 'No account found for the current user' using errcode = 'P0002';
  end if;

  select a.referral_code into v_code from public.accounts a where a.id = v_account_id;

  select r.referral_code into v_referred_by
    from public.accounts a
    join public.accounts r on r.id = a.referred_by_account_id
   where a.id = v_account_id;

  return jsonb_build_object(
    'code', v_code,
    'balanceCents', public.referral_balance_cents(v_account_id),
    'earnedLastYearCents', public.referral_earned_last_year_cents(v_account_id),
    'annualCapCents', public.referral_annual_cap_cents(),
    -- Everyone who signed up with this code, whether or not they have converted
    -- to paid yet — the pending ones are the customer's answer to "I referred
    -- three people, where is my credit?".
    'referredCount', (
      select count(*)::integer from public.accounts a
       where a.referred_by_account_id = v_account_id
    ),
    'convertedCount', (
      select count(*)::integer from public.referral_credits c
       where c.account_id = v_account_id and c.kind = 'earned'
    ),
    'redeemedByCode', v_referred_by,
    'entries', coalesce((
      select jsonb_agg(e order by e.created_at desc)
        from (
          select c.id,
                 c.kind,
                 c.amount_cents as "amountCents",
                 c.note,
                 c.created_at
            from public.referral_credits c
           where c.account_id = v_account_id
           order by c.created_at desc
           limit 50
        ) e
    ), '[]'::jsonb)
  );
end;
$$;

-- Attaches the caller's account to a referrer. One-time and irreversible from
-- the client: re-pointing an attribution after the fact would let an account
-- farm a second payout for the same signup.
create or replace function public.apply_referral_code(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_account_id uuid := public.referral_caller_account_id();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_referrer_id uuid;
  v_existing uuid;
  v_status text;
begin
  if v_account_id is null then
    raise exception 'No account found for the current user' using errcode = 'P0002';
  end if;
  if length(v_code) <> 9 then
    raise exception 'That referral code doesn''t look right — codes are 9 characters.'
      using errcode = '22023';
  end if;

  select referred_by_account_id, subscription_status::text
    into v_existing, v_status
    from public.accounts where id = v_account_id;

  if v_existing is not null then
    raise exception 'A referral code has already been applied to this account.'
      using errcode = '23505';
  end if;

  -- The bonus is for bringing in a *new* paid subscriber. Without this, two
  -- existing subscribers could swap codes and each collect on their next tier
  -- change, since that runs through checkout like any other purchase.
  if v_status in ('active', 'trialing') then
    raise exception 'Referral codes can only be applied before your first paid subscription.'
      using errcode = '22023';
  end if;

  select id into v_referrer_id from public.accounts where referral_code = v_code;
  if v_referrer_id is null then
    raise exception 'That referral code was not found.' using errcode = 'P0002';
  end if;
  if v_referrer_id = v_account_id then
    raise exception 'You can''t refer yourself.' using errcode = '22023';
  end if;

  update public.accounts
     set referred_by_account_id = v_referrer_id,
         referral_attributed_at = now()
   where id = v_account_id;

  return jsonb_build_object('applied', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook-facing API (service role only)
-- ---------------------------------------------------------------------------

-- Called when a referred account completes its first paid checkout. Credits the
-- referrer CAD$1, clamped so the rolling-365-day total never exceeds the cap.
-- Returns the credited amount in cents, or null when nothing was credited
-- (no referrer, already paid out, or the cap is reached) — all of which are
-- normal outcomes, not errors, so the webhook still answers 200.
create or replace function public.award_referral_credit(
  p_referred_account_id uuid,
  p_session_id text
) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  v_referrer_id uuid;
  v_earned integer;
  v_cap integer := public.referral_annual_cap_cents();
  v_amount integer := 100;  -- CAD$1 per converted referral
begin
  select referred_by_account_id into v_referrer_id
    from public.accounts where id = p_referred_account_id;

  if v_referrer_id is null then
    return null;
  end if;

  v_earned := public.referral_earned_last_year_cents(v_referrer_id);
  if v_earned >= v_cap then
    return null;
  end if;
  -- Only relevant if the payout amount is ever raised above CAD$1; keeps a
  -- part-payment landing exactly on the cap rather than stepping over it.
  v_amount := least(v_amount, v_cap - v_earned);

  insert into public.referral_credits
    (account_id, kind, amount_cents, referred_account_id, stripe_session_id, note)
  values
    (v_referrer_id, 'earned', v_amount, p_referred_account_id, p_session_id,
     'Referral bonus — a coach you referred subscribed')
  on conflict do nothing;

  if not found then
    return null;  -- already awarded for this referral or this session
  end if;

  return v_amount;
end;
$$;

-- How much of the balance a checkout may draw down. Separate from
-- referral_balance_cents so the webhook path can call it with the service role
-- without also handing out the caller-scoped helpers.
create or replace function public.referral_available_credit(p_account_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, public.referral_balance_cents(p_account_id));
$$;

-- Debits the balance after Stripe confirms the discounted checkout completed.
-- Deliberately not written when the session is *created*: an abandoned checkout
-- would otherwise burn the customer's credit for a subscription they never
-- bought. Idempotent on the session id.
create or replace function public.record_referral_redemption(
  p_account_id uuid,
  p_session_id text,
  p_amount_cents integer
) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  v_amount integer := coalesce(p_amount_cents, 0);
  v_available integer;
begin
  if v_amount <= 0 then
    return null;
  end if;

  -- Clamp against the live balance. The discount was sized when the session was
  -- created; if anything spent the credit in between, the customer keeps the
  -- discount Stripe already applied but the ledger never goes negative.
  v_available := public.referral_available_credit(p_account_id);
  v_amount := least(v_amount, v_available);
  if v_amount <= 0 then
    return null;
  end if;

  insert into public.referral_credits
    (account_id, kind, amount_cents, stripe_session_id, note)
  values
    (p_account_id, 'redeemed', -v_amount, p_session_id, 'Applied to subscription payment')
  on conflict do nothing;

  if not found then
    return null;
  end if;

  return v_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.ensure_referral_code() from public;
grant execute on function public.ensure_referral_code() to authenticated;

revoke all on function public.get_referral_summary() from public;
grant execute on function public.get_referral_summary() to authenticated;

revoke all on function public.apply_referral_code(text) from public;
grant execute on function public.apply_referral_code(text) to authenticated;

-- Ledger writes and balance lookups on someone else's account are webhook-only.
revoke all on function public.award_referral_credit(uuid, text) from public;
revoke all on function public.award_referral_credit(uuid, text) from anon, authenticated;
grant execute on function public.award_referral_credit(uuid, text) to service_role;

revoke all on function public.record_referral_redemption(uuid, text, integer) from public;
revoke all on function public.record_referral_redemption(uuid, text, integer) from anon, authenticated;
grant execute on function public.record_referral_redemption(uuid, text, integer) to service_role;

revoke all on function public.referral_available_credit(uuid) from public;
revoke all on function public.referral_available_credit(uuid) from anon, authenticated;
grant execute on function public.referral_available_credit(uuid) to service_role;

revoke all on function public.referral_balance_cents(uuid) from public;
revoke all on function public.referral_balance_cents(uuid) from anon, authenticated;
revoke all on function public.referral_earned_last_year_cents(uuid) from public;
revoke all on function public.referral_earned_last_year_cents(uuid) from anon, authenticated;
