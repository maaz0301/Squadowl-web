-- Founder Console additions (all founder-only, security definer):
--   founder_dashboard_stats     the mission-control numbers on the Founder home
--   founder_org_activity        a club's activity timeline
--   founder_set_org_limits      grant a club extra team licenses
--   founder_merge_users         fold a duplicate account into the real one

-- The audit log only accepts known actions; add the ones the new founder tools write.
alter table public.founder_audit_log drop constraint if exists founder_audit_log_action_check;
alter table public.founder_audit_log add constraint founder_audit_log_action_check check (action = any (array[
  'suspend',
  'reactivate',
  'create_org',
  'update_access',
  'impersonate_start',
  'impersonate_end',
  'update_user_role',
  'reset_password',
  'resend_verification',
  'ban_user',
  'unban_user',
  'delete_user',
  'create_announcement',
  'end_announcement',
  'broadcast_email',
  'create_discount_code',
  'update_discount_code',
  'refund_payment',
  'change_subscription',
  'cancel_subscription',
  'resume_subscription',
  'delete_support_ticket',
  'update_team',
  'archive_team',
  'unarchive_team',
  'update_player',
  'add_player_to_team',
  'update_team_roster',
  'remove_player_from_team',
  'update_season',
  'archive_season',
  'unarchive_season',
  'add_season_event',
  'update_season_event',
  'delete_season_event',
  'update_tryout',
  'archive_tryout',
  'unarchive_tryout',
  'delete_tryout',
  'restore_tryout',
  'add_player_to_tryout',
  'update_participant',
  'remove_participant',
  'restore_participant',
  'update_assessor',
  'remove_assessor',
  'update_evaluation',
  'delete_evaluation',
  'update_platform_blocked_features',
  'update_platform_blocked_plan_tiers',
  'update_dummy_data_blocked_plan_tiers',
  'update_limits',
  'merge_users',
  'add_credit',
  'set_billing_date'
]::text[]));

create or replace function public.founder_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v jsonb;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'clubs_total',        count(*),
    'clubs_new_7d',       count(*) filter (where a.created_at >= now() - interval '7 days'),
    'clubs_new_30d',      count(*) filter (where a.created_at >= now() - interval '30 days'),
    'paying',             count(*) filter (where a.subscription_status::text in ('active','trialing','past_due') and a.stripe_subscription_id is not null),
    'trial',              count(*) filter (where public.account_access_status(a) = 'trial'),
    'comp',               count(*) filter (where a.is_comp),
    'suspended',          count(*) filter (where a.suspended_at is not null),
    'past_due',           count(*) filter (where a.subscription_status::text = 'past_due'),
    'canceling',          count(*) filter (where a.subscription_cancel_at is not null),
    'canceled',           count(*) filter (where a.subscription_status::text = 'canceled')
  ) into v
  from public.accounts a
  where not a.hidden_from_founder;

  v := v || jsonb_build_object(
    'users_total',        (select count(*) from public.profiles),
    'signups_7d',         (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'signups_prev_7d',    (select count(*) from public.profiles where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
    'users_active_30d',   (select count(distinct user_id) from public.analytics_feature_usage where day >= (now() at time zone 'utc')::date - 29),
    'users_active_7d',    (select count(distinct user_id) from public.analytics_feature_usage where day >= (now() at time zone 'utc')::date - 6),
    'evaluations_today',  (select count(*) from public.evaluations where created_at >= date_trunc('day', now())),
    'evaluations_7d',     (select count(*) from public.evaluations where created_at >= now() - interval '7 days'),
    'tryouts_today',      (select count(*) from public.tryouts t
                            where t.tryout_date = current_date and t.deleted_at is null and not coalesce(t.archived, false)
                              and not exists (select 1 from public.accounts h where h.id = t.account_id and h.hidden_from_founder)),
    'db_size_bytes',      pg_database_size(current_database()),
    'top_clubs',          coalesce((
      select jsonb_agg(x order by (x->>'evaluations')::int desc) from (
        select jsonb_build_object('accountId', a.id, 'name', a.name,
                 'evaluations', count(e.id)::int,
                 'tryouts', count(distinct t.id)::int) as x
          from public.evaluations e
          join public.tryouts t on t.id = e.tryout_id
          join public.accounts a on a.id = t.account_id
         where e.created_at >= now() - interval '7 days' and not a.hidden_from_founder
         group by a.id, a.name
         order by count(e.id) desc
         limit 5) s), '[]'::jsonb)
  );
  return v;
end;
$$;
grant execute on function public.founder_dashboard_stats() to authenticated;
revoke execute on function public.founder_dashboard_stats() from anon, public;

create or replace function public.founder_org_activity(p_account_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  acc public.accounts;
  v_events jsonb;
  v_last_login timestamptz;
  v_last_eval timestamptz;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into acc from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  select max(u.last_sign_in_at) into v_last_login
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.account_id = p_account_id;

  select max(e.created_at) into v_last_eval
    from public.evaluations e join public.tryouts t on t.id = e.tryout_id
   where t.account_id = p_account_id;

  select coalesce(jsonb_agg(jsonb_build_object('at', ev.at, 'kind', ev.kind, 'label', ev.label) order by ev.at desc), '[]'::jsonb)
    into v_events
    from (
      select * from (
        select acc.created_at as at, 'signup' as kind, 'Organization created' as label
        union all select acc.trial_started_at, 'trial', 'Trial started' where acc.trial_started_at is not null
        union all select acc.first_paid_at, 'paid', 'First payment' where acc.first_paid_at is not null
        union all select acc.suspended_at, 'suspended', 'Suspended' where acc.suspended_at is not null
        union all select m.created_at, 'member', 'Joined as ' || m.role::text || ': ' || coalesce(p.display_name, p.email, 'a user')
          from public.memberships m left join public.profiles p on p.id = m.user_id where m.account_id = p_account_id
        union all select t.created_at, 'tryout', 'Created ' || coalesce(nullif(t.event_type::text, ''), 'event') || ': ' || t.name
          from public.tryouts t where t.account_id = p_account_id and t.deleted_at is null
        union all select tm.created_at, 'team', 'Created team: ' || tm.name
          from public.teams tm where tm.account_id = p_account_id
        union all select v_last_login, 'login', 'Most recent sign-in by a member' where v_last_login is not null
        union all select v_last_eval, 'evaluation', 'Most recent evaluation submitted' where v_last_eval is not null
      ) u order by u.at desc limit 100
    ) ev;

  return jsonb_build_object(
    'lastLoginAt', v_last_login,
    'lastEvaluationAt', v_last_eval,
    'events', v_events);
end;
$$;
grant execute on function public.founder_org_activity(uuid) to authenticated;
revoke execute on function public.founder_org_activity(uuid) from anon, public;

create or replace function public.founder_set_org_limits(p_account_id uuid, p_extra_team_licenses integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  acc public.accounts;
  v_before integer;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_extra_team_licenses is null or p_extra_team_licenses not between 0 and 500 then
    raise exception 'Extra team licenses must be between 0 and 500' using errcode = '22023';
  end if;
  select * into acc from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  v_before := acc.extra_team_licenses;
  update public.accounts set extra_team_licenses = p_extra_team_licenses where id = p_account_id;
  perform public.founder_write_audit('update_limits', acc.id, acc.name, null,
    jsonb_build_object('before', jsonb_build_object('extra_team_licenses', v_before),
                       'after', jsonb_build_object('extra_team_licenses', p_extra_team_licenses)));
  return p_extra_team_licenses;
end;
$$;
grant execute on function public.founder_set_org_limits(uuid, integer) to authenticated;
revoke execute on function public.founder_set_org_limits(uuid, integer) from anon, public;

-- Folds a duplicate account (p_from) into the one to keep (p_into): memberships
-- keep the higher role, every other row that points at the duplicate is
-- re-pointed at the kept account (a row that would collide is dropped), and the
-- duplicate is then banned so it can no longer sign in. Nothing is deleted from
-- auth, so it can be undone by hand from the audit record.
create or replace function public.founder_merge_users(p_from uuid, p_into uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  rank text[] := array['guardian','assessor','coach','admin','owner'];
  r record;
  row_ctid tid;
  v_moved integer := 0;
  v_dropped integer := 0;
  v_from_email text;
  v_into_email text;
  m record;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'Pick two different accounts' using errcode = '22023';
  end if;
  select email into v_from_email from auth.users where id = p_from;
  select email into v_into_email from auth.users where id = p_into;
  if v_from_email is null or v_into_email is null then
    raise exception 'One of the accounts no longer exists' using errcode = 'P0002';
  end if;
  if lower(v_from_email) = 'founder@tryout.ca' then
    raise exception 'The founder account cannot be merged away' using errcode = '42501';
  end if;

  -- Memberships: keep one row per club, with the higher of the two roles.
  for m in select * from public.memberships where user_id = p_from loop
    if exists (select 1 from public.memberships k where k.user_id = p_into and k.account_id = m.account_id) then
      update public.memberships k
         set role = m.role
       where k.user_id = p_into and k.account_id = m.account_id
         and array_position(rank, m.role::text) > array_position(rank, k.role::text);
      delete from public.memberships where id = m.id;
      v_dropped := v_dropped + 1;
    else
      update public.memberships set user_id = p_into where id = m.id;
      v_moved := v_moved + 1;
    end if;
  end loop;

  -- Everything else that references the duplicate.
  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f'
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
       and c.connamespace = 'public'::regnamespace
       and c.conrelid::regclass::text not in ('profiles', 'memberships', 'founder_audit_log', 'platform_admins')
  loop
    for row_ctid in execute format('select ctid from %s where %I = $1', r.tbl, r.col) using p_from loop
      begin
        execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using p_into, row_ctid;
        v_moved := v_moved + 1;
      exception when unique_violation then
        execute format('delete from %s where ctid = $1', r.tbl) using row_ctid;
        v_dropped := v_dropped + 1;
      end;
    end loop;
  end loop;

  -- Fill what the kept profile is missing from the duplicate.
  update public.profiles k
     set display_name = coalesce(nullif(k.display_name, ''), f.display_name),
         avatar_url = coalesce(k.avatar_url, f.avatar_url)
    from public.profiles f
   where k.id = p_into and f.id = p_from;

  update auth.users set banned_until = 'infinity' where id = p_from;

  perform public.founder_write_audit('merge_users', null, null, p_reason,
    jsonb_build_object('from', jsonb_build_object('id', p_from, 'email', v_from_email),
                       'into', jsonb_build_object('id', p_into, 'email', v_into_email),
                       'moved', v_moved, 'dropped', v_dropped));

  return jsonb_build_object('moved', v_moved, 'dropped', v_dropped, 'fromEmail', v_from_email, 'intoEmail', v_into_email);
end;
$$;
grant execute on function public.founder_merge_users(uuid, uuid, text) to authenticated;
revoke execute on function public.founder_merge_users(uuid, uuid, text) from anon, public;
