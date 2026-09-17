-- Founder console: Analytics — sign-up funnel, feature usage, referrals.
--
-- Nothing in the database recorded any of this before:
--   * visits      — no page-view tracking existed. `analytics_visits` counts
--                   anonymous visitors to the sign-in / sign-up screens (the
--                   web app's front door; "/" only redirects there). A
--                   marketing site on another domain can call track_visit()
--                   with the anon key too.
--   * trials/paid — accounts only hold the CURRENT subscription_status, not
--                   when it changed. Two timestamps are added and stamped by a
--                   trigger, so the Stripe webhook (which lives in the mobile
--                   repo) needs no change. Existing rows are backfilled from
--                   the best evidence available — approximate by design.
--   * features    — `analytics_feature_usage`, one row per user, feature and
--                   day with a use counter, written when a feature's screen is
--                   opened (see src/lib/analytics.ts for the feature list).
--   * referrals   — already recorded (20260901120000_loyalty_referral_program);
--                   only founder read RPCs are new.
--
-- Builds on 20260916120000_founder_org_management.sql (is_founder()).
-- Tracking writes go only through the SECURITY DEFINER functions below; the
-- tables have RLS on and no policies, so nobody reads or writes them directly.

-- ---------------------------------------------------------------------------
-- Trial / paid timestamps on accounts
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column if not exists trial_started_at timestamptz;

alter table public.accounts
  add column if not exists first_paid_at timestamptz;

comment on column public.accounts.trial_started_at is
  'When this account first entered a trial (Stripe trialing or a founder trial). Set once by accounts_stamp_funnel.';
comment on column public.accounts.first_paid_at is
  'When this account first had a paid subscription (active / past_due, not comp). Set once by accounts_stamp_funnel.';

-- Only ever fills in the two new columns on the row being written; it never
-- changes or rejects anything else, so existing writers (sign-up's
-- handle_new_user, the Stripe webhook, founder access/suspend RPCs) behave
-- exactly as before.
create or replace function public.accounts_stamp_funnel()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.trial_started_at is null
     and (new.subscription_status = 'trialing'
          or (new.trial_ends_at is not null and new.trial_ends_at > now())) then
    new.trial_started_at := now();
  end if;

  if new.first_paid_at is null
     and new.subscription_status in ('active', 'past_due')
     and not coalesce(new.is_comp, false) then
    new.first_paid_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_stamp_funnel on public.accounts;
create trigger accounts_stamp_funnel
before insert or update of subscription_status, trial_ends_at, is_comp on public.accounts
for each row execute function public.accounts_stamp_funnel();

-- Backfill. There is no history, so: a trial is dated to the account's
-- creation; a paid account to its referral payout if it has one (that row is
-- written by the checkout webhook), otherwise its last update.
--
-- One statement, so every row is read before anything is written, and with
-- the 0001_initial_schema updated_at trigger (trg_accounts_updated_at) paused:
-- otherwise the backfill would stamp updated_at = now() on every touched
-- account, and a trial account that also pays would get its first_paid_at from
-- that fresh timestamp instead of its real last update. The pause is skipped
-- if the trigger isn't there under that name.
do $$
declare
  v_has_trigger boolean := exists (
    select 1 from pg_trigger
     where tgrelid = 'public.accounts'::regclass and tgname = 'trg_accounts_updated_at');
begin
  if v_has_trigger then
    execute 'alter table public.accounts disable trigger trg_accounts_updated_at';
  end if;

  update public.accounts a
     set trial_started_at = case
           when a.trial_started_at is null
                and (a.subscription_status = 'trialing' or a.trial_ends_at is not null)
             then a.created_at
           else a.trial_started_at
         end,
         first_paid_at = case
           when a.first_paid_at is null
                and not coalesce(a.is_comp, false)
                and (a.subscription_status in ('active', 'past_due')
                     or (a.subscription_status = 'canceled' and a.stripe_subscription_id is not null))
             then coalesce(
                    (select min(rc.created_at)
                       from public.referral_credits rc
                      where rc.referred_account_id = a.id and rc.kind = 'earned'),
                    a.updated_at,
                    a.created_at)
           else a.first_paid_at
         end
   where (a.trial_started_at is null
          and (a.subscription_status = 'trialing' or a.trial_ends_at is not null))
      or (a.first_paid_at is null
          and not coalesce(a.is_comp, false)
          and (a.subscription_status in ('active', 'past_due')
               or (a.subscription_status = 'canceled' and a.stripe_subscription_id is not null)));

  if v_has_trigger then
    execute 'alter table public.accounts enable trigger trg_accounts_updated_at';
  end if;
end;
$$;

create index if not exists accounts_created_at_idx on public.accounts (created_at);

-- ---------------------------------------------------------------------------
-- Visits
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_visits (
  id            bigint generated always as identity primary key,
  -- Random id the browser keeps in local storage. Not tied to a person.
  visitor_id    text not null,
  path          text not null,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  ref_code      text,
  day           date not null default (now() at time zone 'utc')::date,
  created_at    timestamptz not null default now()
);

-- One row per visitor, page and day: reloads don't inflate the count, and the
-- table can't be flooded faster than one row per (made-up) visitor id.
create unique index if not exists analytics_visits_once_per_day
  on public.analytics_visits (visitor_id, path, day);

create index if not exists analytics_visits_day_idx on public.analytics_visits (day);

alter table public.analytics_visits enable row level security;

create or replace function public.track_visit(
  p_visitor_id text,
  p_path text,
  p_referrer_host text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_ref_code text default null
) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_visitor_id is null or p_visitor_id !~ '^[A-Za-z0-9-]{8,64}$' then
    return;
  end if;
  if p_path is null or length(p_path) = 0 then
    return;
  end if;

  insert into public.analytics_visits
    (visitor_id, path, referrer_host, utm_source, utm_medium, utm_campaign, ref_code)
  values (
    p_visitor_id,
    left(p_path, 200),
    nullif(left(trim(coalesce(p_referrer_host, '')), 200), ''),
    nullif(left(trim(coalesce(p_utm_source, '')), 100), ''),
    nullif(left(trim(coalesce(p_utm_medium, '')), 100), ''),
    nullif(left(trim(coalesce(p_utm_campaign, '')), 100), ''),
    nullif(upper(left(trim(coalesce(p_ref_code, '')), 20)), '')
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.track_visit(text, text, text, text, text, text, text) from public;
grant execute on function public.track_visit(text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Feature usage
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_feature_usage (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid references public.accounts(id) on delete set null,
  feature      text not null check (feature ~ '^[a-z0-9_]{1,64}$'),
  day          date not null default (now() at time zone 'utc')::date,
  uses         integer not null default 1,
  first_used_at timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create unique index if not exists analytics_feature_usage_user_feature_day
  on public.analytics_feature_usage (user_id, feature, day);

create index if not exists analytics_feature_usage_feature_day_idx
  on public.analytics_feature_usage (feature, day);

alter table public.analytics_feature_usage enable row level security;

-- Filed under the caller's working account (oldest membership, as the app's
-- ctx() picks it). Platform admins — the founder included — are not counted.
create or replace function public.track_feature_use(p_feature text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_feature is null or p_feature !~ '^[a-z0-9_]{1,64}$' then
    return;
  end if;
  if exists (select 1 from public.platform_admins where user_id = v_user) then
    return;
  end if;

  insert into public.analytics_feature_usage (user_id, account_id, feature)
  values (v_user, public.referral_caller_account_id(), p_feature)
  on conflict (user_id, feature, day) do update
    set uses = public.analytics_feature_usage.uses + 1,
        last_used_at = now();
end;
$$;

revoke all on function public.track_feature_use(text) from public;
revoke all on function public.track_feature_use(text) from anon;
grant execute on function public.track_feature_use(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Founder reads
-- ---------------------------------------------------------------------------

-- Oldest owner's email, for labelling an account.
create or replace function public.founder_account_owner_email(p_account_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select p.email::text
    from public.memberships m
    join public.profiles p on p.id = m.user_id
   where m.account_id = p_account_id and m.role = 'owner'
   order by m.created_at asc
   limit 1;
$$;

revoke all on function public.founder_account_owner_email(uuid) from public;
revoke all on function public.founder_account_owner_email(uuid) from anon, authenticated;

-- Funnel over the last p_days days. Sign-ups are new accounts (only coach
-- sign-ups and founder-created orgs make one; guardians and invited assessors
-- don't). Trials and paid are a COHORT of those sign-ups — how many of the
-- accounts created in the period have gone on to trial / pay so far — so each
-- stage is a subset of sign-ups. `trials_started` / `paid_started` are the
-- plain event counts in the period, whatever the account's age.
create or replace function public.founder_analytics_funnel(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 730));
  v_since_day date := (now() at time zone 'utc')::date - (v_days - 1);
  v_since timestamptz := v_since_day::timestamp at time zone 'utc';
  v_totals jsonb;
  v_series jsonb;
  v_sources jsonb;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with cohort as (
    select a.*
      from public.accounts a
     where a.created_at >= v_since
       and not exists (
         select 1 from public.memberships m
           join public.platform_admins pa on pa.user_id = m.user_id
          where m.account_id = a.id and m.role = 'owner')
  )
  select jsonb_build_object(
           'visitors', (select count(distinct visitor_id) from public.analytics_visits where day >= v_since_day),
           'signupVisitors', (select count(distinct visitor_id) from public.analytics_visits
                               where day >= v_since_day and path like '/signup%'),
           'signups', (select count(*) from cohort),
           'trials', (select count(*) from cohort where trial_started_at is not null),
           'paid', (select count(*) from cohort where first_paid_at is not null),
           'trialsStarted', (select count(*) from public.accounts where trial_started_at >= v_since),
           'paidStarted', (select count(*) from public.accounts where first_paid_at >= v_since),
           'firstVisitDay', (select min(day) from public.analytics_visits)
         )
    into v_totals;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day,
           'visitors', coalesce(v.n, 0),
           'signups', coalesce(s.n, 0),
           'trials', coalesce(t.n, 0),
           'paid', coalesce(p.n, 0)
         ) order by d.day), '[]'::jsonb)
    into v_series
    from (select generate_series(v_since_day::timestamp, (now() at time zone 'utc')::date::timestamp, interval '1 day')::date as day) d
    left join (select day, count(distinct visitor_id) n from public.analytics_visits
                where day >= v_since_day group by day) v on v.day = d.day
    left join (select (created_at at time zone 'utc')::date as day, count(*) n from public.accounts
                where created_at >= v_since group by 1) s on s.day = d.day
    left join (select (trial_started_at at time zone 'utc')::date as day, count(*) n from public.accounts
                where trial_started_at >= v_since group by 1) t on t.day = d.day
    left join (select (first_paid_at at time zone 'utc')::date as day, count(*) n from public.accounts
                where first_paid_at >= v_since group by 1) p on p.day = d.day;

  select coalesce(jsonb_agg(jsonb_build_object('source', src, 'visitors', n) order by n desc), '[]'::jsonb)
    into v_sources
    from (
      select coalesce(utm_source, case when ref_code is not null then 'referral code' end, referrer_host, 'direct') as src,
             count(distinct visitor_id) as n
        from public.analytics_visits
       where day >= v_since_day
       group by 1
       order by 2 desc
       limit 10
    ) x;

  return jsonb_build_object('days', v_days, 'totals', v_totals, 'series', v_series, 'sources', v_sources);
end;
$$;

grant execute on function public.founder_analytics_funnel(int) to authenticated;

create or replace function public.founder_analytics_feature_usage(p_days int default 30)
returns table (
  feature       text,
  users         bigint,
  accounts      bigint,
  active_days   bigint,
  uses          bigint,
  last_used_at  timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare
  v_since date := (now() at time zone 'utc')::date - (greatest(1, least(coalesce(p_days, 30), 730)) - 1);
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select u.feature,
         count(distinct u.user_id),
         count(distinct u.account_id),
         count(*),
         coalesce(sum(u.uses), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
   where u.day >= v_since
   group by u.feature
   order by count(distinct u.user_id) desc, u.feature;
end;
$$;

grant execute on function public.founder_analytics_feature_usage(int) to authenticated;

-- Who is using one feature: per account, with the people in it.
create or replace function public.founder_analytics_feature_accounts(p_feature text, p_days int default 30)
returns table (
  account_id    uuid,
  account_name  text,
  owner_email   text,
  users         jsonb,
  active_days   bigint,
  uses          bigint,
  last_used_at  timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare
  v_since date := (now() at time zone 'utc')::date - (greatest(1, least(coalesce(p_days, 30), 730)) - 1);
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select u.account_id,
         a.name,
         public.founder_account_owner_email(u.account_id),
         coalesce(jsonb_agg(distinct jsonb_build_object('id', p.id, 'email', p.email, 'name', p.display_name))
                    filter (where p.id is not null), '[]'::jsonb),
         count(*),
         coalesce(sum(u.uses), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
    left join public.accounts a on a.id = u.account_id
    left join public.profiles p on p.id = u.user_id
   where u.feature = p_feature and u.day >= v_since
   group by u.account_id, a.name
   order by max(u.last_used_at) desc
   limit 200;
end;
$$;

grant execute on function public.founder_analytics_feature_accounts(text, int) to authenticated;

-- Every referred account, with who referred it and what it earned them.
create or replace function public.founder_list_referrals()
returns table (
  referred_account_id   uuid,
  referred_name         text,
  referred_owner_email  text,
  referred_created_at   timestamptz,
  attributed_at         timestamptz,
  subscription_status   text,
  first_paid_at         timestamptz,
  referrer_account_id   uuid,
  referrer_name         text,
  referrer_owner_email  text,
  referrer_code         text,
  credit_cents          integer,
  credited_at           timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select a.id,
         a.name,
         public.founder_account_owner_email(a.id),
         a.created_at,
         a.referral_attributed_at,
         a.subscription_status::text,
         a.first_paid_at,
         r.id,
         r.name,
         public.founder_account_owner_email(r.id),
         r.referral_code,
         rc.amount_cents,
         rc.created_at
    from public.accounts a
    join public.accounts r on r.id = a.referred_by_account_id
    left join public.referral_credits rc
      on rc.referred_account_id = a.id and rc.kind = 'earned'
   order by coalesce(a.referral_attributed_at, a.created_at) desc
   limit 1000;
end;
$$;

grant execute on function public.founder_list_referrals() to authenticated;

-- One row per account that has referred someone or holds credit: what it has
-- earned, spent, and is still owed.
create or replace function public.founder_referral_balances()
returns table (
  account_id      uuid,
  account_name    text,
  owner_email     text,
  referral_code   text,
  referred_count  bigint,
  paid_count      bigint,
  earned_cents    bigint,
  redeemed_cents  bigint,
  adjusted_cents  bigint,
  balance_cents   bigint,
  earned_last_year_cents integer
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with involved as (
    select referred_by_account_id as id from public.accounts where referred_by_account_id is not null
    union
    select rc.account_id from public.referral_credits rc
  )
  select a.id,
         a.name,
         public.founder_account_owner_email(a.id),
         a.referral_code,
         (select count(*) from public.accounts x where x.referred_by_account_id = a.id),
         (select count(*) from public.accounts x where x.referred_by_account_id = a.id and x.first_paid_at is not null),
         coalesce((select sum(amount_cents) from public.referral_credits c where c.account_id = a.id and c.kind = 'earned'), 0)::bigint,
         coalesce((select -sum(amount_cents) from public.referral_credits c where c.account_id = a.id and c.kind = 'redeemed'), 0)::bigint,
         coalesce((select sum(amount_cents) from public.referral_credits c where c.account_id = a.id and c.kind = 'adjustment'), 0)::bigint,
         coalesce((select sum(amount_cents) from public.referral_credits c where c.account_id = a.id), 0)::bigint,
         public.referral_earned_last_year_cents(a.id)
    from involved i
    join public.accounts a on a.id = i.id
   order by 10 desc, 5 desc, a.name;
end;
$$;

grant execute on function public.founder_referral_balances() to authenticated;
