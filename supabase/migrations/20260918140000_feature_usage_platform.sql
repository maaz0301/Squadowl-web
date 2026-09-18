-- Founder analytics: feature usage from the mobile app as well as the web app.
--
-- The Supabase project is shared, so the mobile app records into the same
-- analytics_feature_usage table through the same track_feature_use() RPC. A
-- `platform` column keeps the two apart, so the Feature Usage tab can show
-- either one or both. Every row recorded so far came from the web app, hence
-- the 'web' default.
--
-- Builds on 20260917120000_founder_analytics.sql.

alter table public.analytics_feature_usage
  add column if not exists platform text not null default 'web'
  check (platform in ('web', 'mobile'));

-- One row per user, feature, day *and platform*: someone using the same
-- feature on their phone and their laptop counts on both.
drop index if exists public.analytics_feature_usage_user_feature_day;
create unique index if not exists analytics_feature_usage_user_feature_day_platform
  on public.analytics_feature_usage (user_id, feature, day, platform);

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

-- The old one-argument form goes: leaving both would make a bare
-- track_feature_use('x') call ambiguous. Existing web clients call it with
-- only p_feature, which the default below covers.
drop function if exists public.track_feature_use(text);

create or replace function public.track_feature_use(p_feature text, p_platform text default 'web')
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null
     or p_feature is null or p_feature !~ '^[a-z0-9_]{1,64}$'
     or p_platform is null or p_platform not in ('web', 'mobile') then
    return;
  end if;
  if exists (select 1 from public.platform_admins where user_id = v_user) then
    return;
  end if;

  insert into public.analytics_feature_usage (user_id, account_id, feature, platform)
  values (v_user, public.referral_caller_account_id(), p_feature, p_platform)
  on conflict (user_id, feature, day, platform) do update
    set uses = public.analytics_feature_usage.uses + 1,
        last_used_at = now();
end;
$$;

revoke all on function public.track_feature_use(text, text) from public;
revoke all on function public.track_feature_use(text, text) from anon;
grant execute on function public.track_feature_use(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Founder reads
-- ---------------------------------------------------------------------------

-- p_platform: null = both, or 'web' / 'mobile'. web_uses / mobile_uses always
-- describe the whole period regardless of the filter's own platform, so a row
-- can show its split; with a filter on, the other side simply reads 0.
drop function if exists public.founder_analytics_feature_usage(int);

create or replace function public.founder_analytics_feature_usage(p_days int default 30, p_platform text default null)
returns table (
  feature       text,
  users         bigint,
  accounts      bigint,
  active_days   bigint,
  uses          bigint,
  web_uses      bigint,
  mobile_uses   bigint,
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
         count(distinct (u.user_id, u.day)),
         coalesce(sum(u.uses), 0)::bigint,
         coalesce(sum(u.uses) filter (where u.platform = 'web'), 0)::bigint,
         coalesce(sum(u.uses) filter (where u.platform = 'mobile'), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
   where u.day >= v_since
     and (p_platform is null or u.platform = p_platform)
   group by u.feature
   order by count(distinct u.user_id) desc, u.feature;
end;
$$;

grant execute on function public.founder_analytics_feature_usage(int, text) to authenticated;

-- Who is using one feature: per account, with the people in it.
drop function if exists public.founder_analytics_feature_accounts(text, int);

create or replace function public.founder_analytics_feature_accounts(
  p_feature text,
  p_days int default 30,
  p_platform text default null
)
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
         count(distinct (u.user_id, u.day)),
         coalesce(sum(u.uses), 0)::bigint,
         max(u.last_used_at)
    from public.analytics_feature_usage u
    left join public.accounts a on a.id = u.account_id
    left join public.profiles p on p.id = u.user_id
   where u.feature = p_feature and u.day >= v_since
     and (p_platform is null or u.platform = p_platform)
   group by u.account_id, a.name
   order by max(u.last_used_at) desc
   limit 200;
end;
$$;

grant execute on function public.founder_analytics_feature_accounts(text, int, text) to authenticated;
