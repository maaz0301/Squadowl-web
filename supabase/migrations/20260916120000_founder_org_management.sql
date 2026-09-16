-- Founder console: organization list, access status, suspend/reactivate,
-- manual (pilot) account creation, and an audit log.
--
-- Everything here is gated to ONE identity — founder@tryout.ca — rather than a
-- role. The app's roles are all per-account (a club admin administers their own
-- club), so nothing existing expresses "operates the platform". The gate reads
-- the address from auth.users (not from `profiles`, which the user can edit)
-- and requires it to be confirmed, so nobody can claim it by signing up with
-- the address before the founder does.
--
-- Status model. Nothing new is stored for "active" or "trial"; they are
-- derived by account_access_status() so there is no status column that can
-- drift out of step with Stripe:
--   suspended  suspended_at is set (a founder action), OR a founder-granted
--              trial (trial_ends_at) has run out with no paid subscription
--   trial      Stripe says 'trialing', OR trial_ends_at is still in the future
--   active     everything else (paying, free, or comp)
-- A comp account (is_comp) never expires.
--
-- Enforcement is in the RLS helpers: has_account_access / has_account_role stop
-- matching a membership on a suspended account, which cuts every account-scoped
-- table off at once. Two narrow policies keep the member able to read their own
-- membership and account row, so the app can say "your organization is
-- suspended" instead of failing with "No account for user".

-- ---------------------------------------------------------------------------
-- Account columns
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists trial_ends_at    timestamptz,
  add column if not exists is_comp          boolean not null default false;

comment on column public.accounts.suspended_at is
  'Set when the founder suspends the account; members lose access to all account data until it is cleared.';
comment on column public.accounts.suspended_reason is
  'Optional note the founder gave when suspending.';
comment on column public.accounts.trial_ends_at is
  'End of a founder-granted trial. Once past, the account is treated as suspended unless it is comp or has a live paid subscription.';
comment on column public.accounts.is_comp is
  'Complimentary account (pilot/partner): full access at its plan tier, never expires.';

-- The founder list sorts and pages on this.
create index if not exists idx_accounts_type_created
  on public.accounts (type, created_at desc);

-- ---------------------------------------------------------------------------
-- Gate
-- ---------------------------------------------------------------------------

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
      from auth.users u
     where u.id = auth.uid()
       and lower(u.email) = 'founder@tryout.ca'
       and u.email_confirmed_at is not null
  );
$$;

comment on function public.is_founder() is
  'True only for the confirmed founder@tryout.ca user.';

grant execute on function public.is_founder() to authenticated;

-- "View as organization" reads the org's data through the normal RLS
-- policies, which already let a platform admin through. Adds the founder if
-- their user exists; a no-op otherwise (re-run this statement after they sign
-- up).
insert into public.platform_admins (user_id)
select p.id
  from public.profiles p
  join auth.users u on u.id = p.id
 where lower(u.email) = 'founder@tryout.ca'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Derived status
-- ---------------------------------------------------------------------------

-- Plain SQL, not SECURITY DEFINER and no side effects, so the planner can
-- inline it into the RLS helpers below instead of calling it per row.
create or replace function public.account_access_status(a public.accounts)
returns text language sql stable as $$
  select case
    when a.suspended_at is not null then 'suspended'
    when a.subscription_status = 'trialing' then 'trial'
    when a.trial_ends_at is null or a.is_comp then 'active'
    when a.subscription_status in ('active', 'past_due') then 'active'
    when a.trial_ends_at > now() then 'trial'
    else 'suspended'
  end;
$$;

comment on function public.account_access_status(public.accounts) is
  'active | trial | suspended — see 20260916120000_founder_org_management.sql for the rules.';

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------

-- Same bodies as 0001_initial_schema.sql plus the suspension check. The join is
-- a primary-key lookup on a row already found through idx_memberships_user.
create or replace function public.has_account_access(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1
                   from public.memberships m
                   join public.accounts a on a.id = m.account_id
                  where m.user_id = auth.uid()
                    and m.account_id = target
                    and public.account_access_status(a) <> 'suspended');
$$;

create or replace function public.has_account_role(target uuid, roles membership_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1
                   from public.memberships m
                   join public.accounts a on a.id = m.account_id
                  where m.user_id = auth.uid()
                    and m.account_id = target
                    and m.role = any(roles)
                    and public.account_access_status(a) <> 'suspended');
$$;

-- A member of a suspended account can still see that they are one, and why.
-- Permissive policies OR with accounts_read / memberships_read, so nothing that
-- was readable before stops being readable.
drop policy if exists memberships_read_self on public.memberships;
create policy memberships_read_self on public.memberships
  for select using (user_id = auth.uid());

drop policy if exists accounts_read_member on public.accounts;
create policy accounts_read_member on public.accounts
  for select using (
    exists (select 1 from public.memberships m
             where m.account_id = accounts.id and m.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table if not exists public.founder_audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  action       text not null check (action in (
                 'suspend', 'reactivate', 'create_org', 'update_access',
                 'impersonate_start', 'impersonate_end')),
  account_id   uuid references public.accounts(id) on delete set null,
  -- Copied so the entry still reads sensibly after the account is renamed or deleted.
  account_name text,
  reason       text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists founder_audit_log_created_idx
  on public.founder_audit_log (created_at desc);
create index if not exists founder_audit_log_account_idx
  on public.founder_audit_log (account_id, created_at desc);

alter table public.founder_audit_log enable row level security;

-- Read-only to the founder. There are no insert/update/delete policies: rows
-- are written only by the SECURITY DEFINER functions below, in the same
-- transaction as the change they record, so an action can't happen unlogged
-- and a log entry can't be edited afterwards.
drop policy if exists founder_audit_log_read on public.founder_audit_log;
create policy founder_audit_log_read on public.founder_audit_log
  for select using (public.is_founder());

create or replace function public.founder_write_audit(
  p_action text, p_account_id uuid, p_account_name text, p_reason text, p_details jsonb
) returns void language sql security definer set search_path = public, auth as $$
  insert into public.founder_audit_log (actor_id, actor_email, action, account_id, account_name, reason, details)
  select auth.uid(), u.email, p_action, p_account_id, p_account_name, nullif(trim(p_reason), ''), coalesce(p_details, '{}'::jsonb)
    from (select 1) one
    left join auth.users u on u.id = auth.uid();
$$;

-- Internal only.
revoke all on function public.founder_write_audit(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- One page of accounts, filtered and searched server-side. Status is computed
-- for the whole filtered set (it is what the filter runs on), but the owner
-- and the per-row counts are looked up only for the rows on the page.
create or replace function public.founder_list_organizations(
  p_search text default null,
  p_status text default null,           -- null | 'active' | 'trial' | 'suspended'
  p_include_individual boolean default false,
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id                  uuid,
  name                text,
  account_type        text,
  plan_tier           text,
  subscription_status text,
  access_status       text,
  suspended_at        timestamptz,
  suspended_reason    text,
  trial_ends_at       timestamptz,
  is_comp             boolean,
  owner_email         text,
  member_count        int,
  team_count          int,
  created_at          timestamptz,
  total_count         bigint
) language plpgsql stable security definer set search_path = public as $$
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
     where (p_include_individual or a.type = 'organization')
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
$$;

grant execute on function public.founder_list_organizations(text, text, boolean, int, int) to authenticated;

-- Suspend (p_suspended = true) or reactivate. Reactivating also clears an
-- expired founder trial, since otherwise the account would still derive as
-- suspended. Refuses a no-op so the log only records real changes.
create or replace function public.founder_set_organization_suspended(
  p_account_id uuid,
  p_suspended boolean,
  p_reason text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  acc public.accounts;
  before_status text;
  after_status text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into acc from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  before_status := public.account_access_status(acc);

  if p_suspended then
    if before_status = 'suspended' then
      raise exception 'Organization is already suspended' using errcode = '22023';
    end if;
    update public.accounts
       set suspended_at = now(), suspended_reason = nullif(trim(p_reason), '')
     where id = p_account_id
    returning * into acc;
  else
    if before_status <> 'suspended' then
      raise exception 'Organization is not suspended' using errcode = '22023';
    end if;
    update public.accounts
       set suspended_at = null,
           suspended_reason = null,
           trial_ends_at = case when trial_ends_at <= now() then null else trial_ends_at end
     where id = p_account_id
    returning * into acc;
  end if;

  after_status := public.account_access_status(acc);

  perform public.founder_write_audit(
    case when p_suspended then 'suspend' else 'reactivate' end,
    acc.id, acc.name, p_reason,
    jsonb_build_object('from', before_status, 'to', after_status));

  return after_status;
end;
$$;

grant execute on function public.founder_set_organization_suspended(uuid, boolean, text) to authenticated;

-- Change plan tier and access type: 'active' (normal), 'trial' (ends after
-- p_trial_days) or 'comp' (free, never expires). Does not touch suspension.
create or replace function public.founder_update_organization_access(
  p_account_id uuid,
  p_plan_tier text,
  p_access text,
  p_trial_days int default 30
) returns text language plpgsql security definer set search_path = public as $$
declare
  acc public.accounts;
  before_json jsonb;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_access not in ('active', 'trial', 'comp') then
    raise exception 'Access must be active, trial or comp' using errcode = '22023';
  end if;
  if p_access = 'trial' and coalesce(p_trial_days, 0) not between 1 and 365 then
    raise exception 'Trial length must be 1–365 days' using errcode = '22023';
  end if;

  select * into acc from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  before_json := jsonb_build_object('plan_tier', acc.plan_tier, 'is_comp', acc.is_comp, 'trial_ends_at', acc.trial_ends_at);

  update public.accounts
     set plan_tier     = p_plan_tier::plan_tier,
         is_comp       = (p_access = 'comp'),
         trial_ends_at = case when p_access = 'trial' then now() + make_interval(days => p_trial_days) else null end
   where id = p_account_id
  returning * into acc;

  perform public.founder_write_audit(
    'update_access', acc.id, acc.name, null,
    jsonb_build_object(
      'before', before_json,
      'after', jsonb_build_object('plan_tier', acc.plan_tier, 'is_comp', acc.is_comp, 'trial_ends_at', acc.trial_ends_at)));

  return public.account_access_status(acc);
end;
$$;

grant execute on function public.founder_update_organization_access(uuid, text, text, int) to authenticated;

-- Pilot onboarding. The owner must already have a user (the client creates one
-- through the create-user edge function when this raises 'Owner not found',
-- then retries). A brand-new user already has the empty personal account the
-- signup trigger made for them; that account is converted into the
-- organization rather than leaving them with two owner accounts to be
-- resolved between.
create or replace function public.founder_create_organization(
  p_name text,
  p_owner_email text,
  p_plan_tier text,
  p_access text,
  p_trial_days int default 30,
  p_sport text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_owner_email, '')));
  v_owner uuid;
  v_account uuid;
  v_reused boolean := false;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Organization name is required' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid owner email is required' using errcode = '22023';
  end if;
  if p_access not in ('active', 'trial', 'comp') then
    raise exception 'Access must be active, trial or comp' using errcode = '22023';
  end if;
  if p_access = 'trial' and coalesce(p_trial_days, 0) not between 1 and 365 then
    raise exception 'Trial length must be 1–365 days' using errcode = '22023';
  end if;

  if exists (select 1 from public.accounts
              where type = 'organization' and lower(name) = lower(v_name)) then
    raise exception 'An organization named "%" already exists', v_name using errcode = '23505';
  end if;

  select p.id into v_owner from public.profiles p where lower(p.email) = v_email;
  if v_owner is null then
    raise exception 'Owner not found' using errcode = 'P0002';
  end if;

  -- The signup trigger's personal account, untouched: sole member, no billing,
  -- no teams, tryouts or seasons.
  select a.id into v_account
    from public.memberships m
    join public.accounts a on a.id = m.account_id
   where m.user_id = v_owner
     and m.role = 'owner'
     and a.type = 'individual'
     and a.stripe_subscription_id is null
     and not exists (select 1 from public.memberships m2 where m2.account_id = a.id and m2.user_id <> v_owner)
     and not exists (select 1 from public.teams t where t.account_id = a.id)
     and not exists (select 1 from public.tryouts ty where ty.account_id = a.id)
     and not exists (select 1 from public.seasons s where s.account_id = a.id)
   order by a.created_at
   limit 1
   for update of a;

  if v_account is not null then
    v_reused := true;
    update public.accounts
       set type          = 'organization',
           name          = v_name,
           sport         = coalesce(nullif(trim(p_sport), ''), sport),
           plan_tier     = p_plan_tier::plan_tier,
           is_comp       = (p_access = 'comp'),
           trial_ends_at = case when p_access = 'trial' then now() + make_interval(days => p_trial_days) end,
           suspended_at  = null
     where id = v_account;
  else
    insert into public.accounts (type, name, sport, plan_tier, is_comp, trial_ends_at)
    values ('organization', v_name, nullif(trim(p_sport), ''), p_plan_tier::plan_tier,
            p_access = 'comp',
            case when p_access = 'trial' then now() + make_interval(days => p_trial_days) end)
    returning id into v_account;

    insert into public.memberships (account_id, user_id, role)
    values (v_account, v_owner, 'owner')
    on conflict (account_id, user_id) do update set role = 'owner';
  end if;

  perform public.founder_write_audit(
    'create_org', v_account, v_name, null,
    jsonb_build_object('owner_email', v_email, 'plan_tier', p_plan_tier, 'access', p_access,
                       'trial_days', case when p_access = 'trial' then p_trial_days end,
                       'converted_personal_account', v_reused));

  return json_build_object('id', v_account, 'ownerUserId', v_owner, 'convertedPersonalAccount', v_reused);
end;
$$;

grant execute on function public.founder_create_organization(text, text, text, text, int, text) to authenticated;

-- Impersonation happens in the client (the founder is a platform admin, so the
-- normal RLS already lets them read the org); this records entering and leaving.
create or replace function public.founder_log_impersonation(p_account_id uuid, p_started boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select name into v_name from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  perform public.founder_write_audit(
    case when p_started then 'impersonate_start' else 'impersonate_end' end,
    p_account_id, v_name, null, '{}'::jsonb);
end;
$$;

grant execute on function public.founder_log_impersonation(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Suspension also cuts off guardians, invited assessors and delegated
-- team managers — not just the account's own owner/admin/coach members.
-- ---------------------------------------------------------------------------
--
-- has_account_access() / has_account_role() above are the gate for STAFF
-- membership only. Several other functions grant access by identity instead —
-- guardian_user_id = auth.uid(), tryout_assessors.user_id = auth.uid(),
-- team_managers.user_id = auth.uid() — and none of those go through
-- has_account_role at all, so the redefinitions above leave them untouched. A
-- guardian whose athlete plays for a suspended club, an assessor invited to
-- its tryouts, or a coach delegated one of its teams would all keep exactly
-- the access they had before suspending it.
--
-- Fixed at the two identity-check functions everything else calls
-- (is_team_manager, is_team_guardian) plus the handful of places a guardian or
-- assessor branch is inlined directly (can_access_athlete, can_access_season,
-- can_access_tryout, can_edit_athlete_contacts) — same technique as above:
-- AND the existing identity check with "the owning account isn't suspended",
-- touching nothing else about who already had access.
--
-- Fixing is_team_manager() alone cascades to everything else that calls it:
-- can_access_athlete, can_access_season, can_access_tryout, can_manage_team,
-- can_manage_tryout, teams_manager_read/-_update, team_roster_manager_rw,
-- season_events_manager_write, season_roster_manager_write — none of those
-- need their own redefinition.
--
-- Deliberately NOT touched here (same reasoning, narrower blast radius, ask
-- before going further): athlete_shares / athlete_share_live_scores (a
-- guardian's own peer-to-peer share to a coach, not the org's roster data —
-- the coach's own side is already has_account_role-gated), and the
-- event_rsvp_tokens email-link flow (a bearer-token capability handed out by
-- email, not an identity check RLS gates the normal way; blocking it needs the
-- RPC itself to check account_access_status, not a policy change).

-- account_access_status() by account id, so a caller that already has the
-- account_id in scope doesn't need to join accounts just to call the
-- accounts-row version above.
create or replace function public.account_access_status(account_id uuid)
returns text language sql stable as $$
  select public.account_access_status(a) from public.accounts a where a.id = account_id;
$$;

create or replace function public.is_team_manager(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_managers tm
    join public.teams te on te.id = tm.team_id
    where tm.team_id = t
      and tm.user_id = auth.uid()
      and public.account_access_status(te.account_id) <> 'suspended'
  );
$$;

create or replace function public.is_team_guardian(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    join public.athletes at on at.id = sr.athlete_id
    where se.team_id = t
      and at.guardian_user_id = auth.uid()
  )
  and exists (
    select 1 from public.teams te
    where te.id = t and public.account_access_status(te.account_id) <> 'suspended'
  );
$$;

-- Body otherwise identical to 20260818120000_team_managers.sql's definition:
-- staff (unchanged), assessor and guardian branches gated on the tryout's own
-- account, has_athlete_account_access() and the two is_team_manager() branches
-- already fixed above.
create or replace function public.can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
      or (at.guardian_user_id = auth.uid() and public.account_access_status(at.account_id) <> 'suspended')
    )
  )
  or exists (
    select 1 from public.tryout_participants tp
    join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
    join public.tryouts ty on ty.id = tp.tryout_id
    where tp.athlete_id = a and ta.user_id = auth.uid()
      and public.account_access_status(ty.account_id) <> 'suspended'
  )
  or public.has_athlete_account_access(a)
  or exists (
    select 1 from public.team_roster tr
    where tr.athlete_id = a and public.is_team_manager(tr.team_id)
  )
  or exists (
    select 1 from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    where sr.athlete_id = a
      and se.team_id is not null
      and public.is_team_manager(se.team_id)
  );
$$;

-- Body otherwise identical to 20260818120000_team_managers.sql's definition:
-- staff and is_team_manager() branches unchanged (the latter fixed above),
-- guardian branch gated on the season's own account.
create or replace function public.can_access_season(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seasons se where se.id = s and (
      public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
      or (se.team_id is not null and public.is_team_manager(se.team_id))
      or exists (
        select 1 from public.season_roster sr
        join public.athletes at on at.id = sr.athlete_id
        where sr.season_id = s and at.guardian_user_id = auth.uid()
          and public.account_access_status(se.account_id) <> 'suspended'
      )
    )
  );
$$;

-- Body otherwise identical to 20260915140000_restore_guardian_tryout_access.sql's
-- definition: staff, the team-manager branch and the team's-own-staff branch
-- are unchanged (the first fixed above); assessor and guardian branches gated
-- on the tryout's own account.
create or replace function public.can_access_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t and (
      public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
      or (
        exists (select 1 from public.tryout_assessors ta
                where ta.tryout_id = t and ta.user_id = auth.uid())
        and public.account_access_status(ty.account_id) <> 'suspended'
      )
      or (
        exists (select 1 from public.tryout_participants tp
                join public.athletes a on a.id = tp.athlete_id
                where tp.tryout_id = t and a.guardian_user_id = auth.uid())
        and public.account_access_status(ty.account_id) <> 'suspended'
      )
      or (ty.team_id is not null and public.is_team_manager(ty.team_id))
      or (ty.team_id is not null and exists (
            select 1 from public.teams te where te.id = ty.team_id
              and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
          ))
    )
  );
$$;

-- Body otherwise identical to 20260824120000_athlete_family_contacts.sql's
-- definition: guardian branch gated on the athlete's own account.
create or replace function public.can_edit_athlete_contacts(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      (at.guardian_user_id = auth.uid() and public.account_access_status(at.account_id) <> 'suspended')
      or public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
    )
  );
$$;
