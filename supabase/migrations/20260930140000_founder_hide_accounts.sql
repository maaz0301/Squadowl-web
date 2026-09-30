-- Temporary founder-console hiding: flagged accounts are excluded from founder_* lists and metrics.
-- Reversible: update public.accounts set hidden_from_founder = false where ...
alter table public.accounts add column if not exists hidden_from_founder boolean not null default false;

CREATE OR REPLACE FUNCTION public.founder_analytics_feature_accounts(p_feature text, p_days integer DEFAULT 30, p_platform text DEFAULT NULL::text)
 RETURNS TABLE(account_id uuid, account_name text, owner_email text, users jsonb, active_days bigint, uses bigint, last_used_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         count(distinct (u.user_id, u.day)),
         coalesce(sum(u.uses), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
    left join public.accounts a on a.id = u.account_id
    left join public.profiles p on p.id = u.user_id
   where u.feature = p_feature and u.day >= v_since
     and not exists (select 1 from public.accounts h where h.id = u.account_id and h.hidden_from_founder)
     and (p_platform is null or u.platform = p_platform)
   group by u.account_id, a.name
   order by max(u.last_used_at) desc
   limit 200;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.founder_analytics_feature_usage(p_days integer DEFAULT 30, p_platform text DEFAULT NULL::text)
 RETURNS TABLE(feature text, users bigint, accounts bigint, active_days bigint, uses bigint, web_uses bigint, mobile_uses bigint, last_used_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         count(distinct (u.user_id, u.day)),
         coalesce(sum(u.uses), 0)::bigint,
         coalesce(sum(u.uses) filter (where u.platform = 'web'), 0)::bigint,
         coalesce(sum(u.uses) filter (where u.platform = 'mobile'), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
   where u.day >= v_since
     and not exists (select 1 from public.accounts h where h.id = u.account_id and h.hidden_from_founder)
     and (p_platform is null or u.platform = p_platform)
   group by u.feature
   order by count(distinct u.user_id) desc, u.feature;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.founder_analytics_funnel(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and not a.hidden_from_founder
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
           'trialsStarted', (select count(*) from public.accounts where not hidden_from_founder and trial_started_at >= v_since),
           'paidStarted', (select count(*) from public.accounts where not hidden_from_founder and first_paid_at >= v_since),
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
                where not hidden_from_founder and created_at >= v_since group by 1) s on s.day = d.day
    left join (select (trial_started_at at time zone 'utc')::date as day, count(*) n from public.accounts
                where not hidden_from_founder and trial_started_at >= v_since group by 1) t on t.day = d.day
    left join (select (first_paid_at at time zone 'utc')::date as day, count(*) n from public.accounts
                where not hidden_from_founder and first_paid_at >= v_since group by 1) p on p.day = d.day;

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
$function$
;

CREATE OR REPLACE FUNCTION public.founder_list_organizations(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_include_individual boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, account_type text, plan_tier text, subscription_status text, access_status text, suspended_at timestamp with time zone, suspended_reason text, trial_ends_at timestamp with time zone, is_comp boolean, owner_email text, member_count integer, team_count integer, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select a.*, public.account_access_status(a) as status
      from public.accounts a
     where not a.hidden_from_founder
       and (p_include_individual or a.type = 'organization')
       and (q is null
            or a.name ilike '%' || q || '%'
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
     where p_status is null or f.status = p_status
     order by f.created_at desc, f.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id,
         pg.name,
         pg.type::text,
         pg.plan_tier::text,
         pg.subscription_status::text,
         pg.status,
         pg.suspended_at,
         pg.suspended_reason,
         pg.trial_ends_at,
         pg.is_comp,
         o.email::text,
         coalesce(mc.n, 0)::int,
         coalesce(tc.n, 0)::int,
         pg.created_at,
         pg.total
    from page pg
    left join lateral (
      select p.email
        from public.memberships m
        join public.profiles p on p.id = m.user_id
       where m.account_id = pg.id and m.role = 'owner'
       order by m.created_at
       limit 1
    ) o on true
    left join lateral (select count(*) as n from public.memberships m where m.account_id = pg.id) mc on true
    left join lateral (select count(*) as n from public.teams t where t.account_id = pg.id and not t.archived) tc on true
   order by pg.created_at desc, pg.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.founder_list_referrals()
 RETURNS TABLE(referred_account_id uuid, referred_name text, referred_owner_email text, referred_created_at timestamp with time zone, attributed_at timestamp with time zone, subscription_status text, first_paid_at timestamp with time zone, referrer_account_id uuid, referrer_name text, referrer_owner_email text, referrer_code text, credit_cents integer, credited_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where not a.hidden_from_founder and not r.hidden_from_founder
   order by coalesce(a.referral_attributed_at, a.created_at) desc
   limit 1000;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.founder_list_subscriptions(p_search text DEFAULT NULL::text, p_tier text DEFAULT NULL::text, p_billing text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, account_type text, plan_tier text, subscription_status text, access_status text, is_comp boolean, trial_ends_at timestamp with time zone, stripe_customer_id text, stripe_subscription_id text, subscription_cancel_at timestamp with time zone, pending_plan_tier text, pending_plan_change_at timestamp with time zone, extra_team_licenses integer, first_paid_at timestamp with time zone, owner_email text, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     where not a.hidden_from_founder
       and (p_tier is null or a.plan_tier::text = p_tier)
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
$function$
;

CREATE OR REPLACE FUNCTION public.founder_list_users(p_search text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, email text, display_name text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, email_confirmed_at timestamp with time zone, banned_until timestamp with time zone, memberships jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with base as (
    select p.id, p.email, p.display_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until
      from public.profiles p
      join auth.users u on u.id = p.id
     where not exists (select 1 from public.memberships hm join public.accounts ha on ha.id = hm.account_id
                        where hm.user_id = p.id and ha.hidden_from_founder)
       and (q is null
            or p.email ilike '%' || q || '%'
            or p.display_name ilike '%' || q || '%'
            or exists (select 1
                         from public.memberships m
                         join public.accounts a on a.id = m.account_id
                        where m.user_id = p.id and a.name ilike '%' || q || '%'))
       and (p_account_id is null or exists (
             select 1 from public.memberships m where m.user_id = p.id and m.account_id = p_account_id))
       and (p_role is null or exists (
             select 1 from public.memberships m where m.user_id = p.id and m.role::text = p_role))
  ),
  page as (
    select b.*, count(*) over () as total
      from base b
     order by b.created_at desc, b.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id,
         pg.email::text,
         pg.display_name,
         pg.created_at,
         pg.last_sign_in_at,
         pg.email_confirmed_at,
         pg.banned_until,
         coalesce(mj.memberships, '[]'::jsonb),
         pg.total
    from page pg
    left join lateral (
      select jsonb_agg(
               jsonb_build_object('accountId', m.account_id, 'accountName', a.name, 'role', m.role)
               order by a.name
             ) as memberships
        from public.memberships m
        join public.accounts a on a.id = m.account_id
       where m.user_id = pg.id
    ) mj on true
   order by pg.created_at desc, pg.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.founder_referral_balances()
 RETURNS TABLE(account_id uuid, account_name text, owner_email text, referral_code text, referred_count bigint, paid_count bigint, earned_cents bigint, redeemed_cents bigint, adjusted_cents bigint, balance_cents bigint, earned_last_year_cents integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where not a.hidden_from_founder
   order by 10 desc, 5 desc, a.name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.founder_subscription_counts()
 RETURNS TABLE(plan_tier text, accounts integer, paying integer, comp integer, trial integer, past_due integer, canceling integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where not a.hidden_from_founder
   group by a.plan_tier
   order by a.plan_tier;
end;
$function$
;

update public.accounts set hidden_from_founder = true where id = '83161007-aacd-4484-8206-c6db0708a3f4';
