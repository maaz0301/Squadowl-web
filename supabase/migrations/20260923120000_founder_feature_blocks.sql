-- Founder console: platform-wide feature blocks.
--
-- A lighter tool than Suspend — the founder can turn off one or more hub
-- sections (Evaluations, Teams, Dashboard, Profile, My Athletes, Manage
-- Organization, Loyalty Program, Plans & Billing) for the whole platform at
-- once: every organization, every user, no account involved — a
-- maintenance-style kill switch. Deliberately not backed by RLS the way
-- suspension is: this is a UI-level gate the app checks to hide the nav item
-- and show a "blocked" screen in its place, not a data boundary.
-- See src/lib/blockableFeatures.ts and AppShell.tsx.

-- founder_write_audit() inserts into founder_audit_log, whose `action` column
-- is a fixed check constraint (most recently extended in
-- 20260918130000_founder_console_write_audit.sql) — the new action kind below
-- needs to be added to it or the insert fails at call time.
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
    'refund_payment', 'change_subscription', 'cancel_subscription', 'resume_subscription',
    'delete_support_ticket',
    'update_team', 'archive_team', 'unarchive_team',
    'update_player', 'add_player_to_team', 'update_team_roster', 'remove_player_from_team',
    'update_season', 'archive_season', 'unarchive_season',
    'add_season_event', 'update_season_event', 'delete_season_event',
    'update_tryout', 'archive_tryout', 'unarchive_tryout', 'delete_tryout', 'restore_tryout',
    'add_player_to_tryout', 'update_participant', 'remove_participant', 'restore_participant',
    'update_assessor', 'remove_assessor',
    'update_evaluation', 'delete_evaluation',
    'update_platform_blocked_features', 'update_platform_blocked_plan_tiers'
  ));

-- Singleton settings row (id is always true, so only one row can ever exist).
create table if not exists public.platform_settings (
  id                 boolean primary key default true,
  blocked_features   text[] not null default '{}'::text[],
  blocked_plan_tiers text[] not null default '{}'::text[],
  updated_at         timestamptz not null default now(),
  constraint platform_settings_singleton check (id),
  constraint platform_settings_blocked_features_valid
    check (blocked_features <@ array[
      'evaluations', 'teams', 'dashboard', 'profile', 'myAthletes',
      'organization', 'loyalty', 'billing'
    ]::text[]),
  constraint platform_settings_blocked_plan_tiers_valid
    check (blocked_plan_tiers <@ array['free', 'coach', 'coach_plus', 'club']::text[])
);

comment on table public.platform_settings is
  'Single-row platform-wide config. blocked_features is a kill switch per hub section; blocked_plan_tiers hides one plan tier from checkout/upgrade — both apply to every organization and user at once.';

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

-- Locked down: nobody reads or writes the table directly, only through the
-- two functions below (both security definer, so RLS doesn't need a policy
-- granting access to the row itself).
alter table public.platform_settings enable row level security;

-- Every signed-in screen needs this to gate its own nav — unlike the founder
-- RPC below, deliberately not restricted to is_founder().
create or replace function public.platform_blocked_features()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select blocked_features from public.platform_settings where id), array[]::text[]);
$$;

grant execute on function public.platform_blocked_features() to authenticated, anon;

-- Replaces the whole set at once (the founder console always edits it as a
-- checkbox group, never one flag at a time).
create or replace function public.founder_set_platform_blocked_features(
  p_blocked_features text[]
) returns text[] language plpgsql security definer set search_path = public as $$
declare
  before_features text[];
  next_features text[];
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not (p_blocked_features <@ array[
    'evaluations', 'teams', 'dashboard', 'profile', 'myAthletes',
    'organization', 'loyalty', 'billing'
  ]::text[]) then
    raise exception 'Unknown feature key' using errcode = '22023';
  end if;

  select blocked_features into before_features from public.platform_settings where id for update;

  select coalesce(array_agg(distinct f order by f), array[]::text[]) into next_features
    from unnest(p_blocked_features) f;

  if next_features = before_features then
    return before_features;
  end if;

  update public.platform_settings set blocked_features = next_features, updated_at = now() where id;

  perform public.founder_write_audit(
    'update_platform_blocked_features', null, 'Platform', null,
    jsonb_build_object('before', to_jsonb(before_features), 'after', to_jsonb(next_features)));

  return next_features;
end;
$$;

grant execute on function public.founder_set_platform_blocked_features(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform-wide plan-tier blocks — hides one tier from checkout/upgrade
-- without touching anyone already subscribed to it or any hub section above.
-- ---------------------------------------------------------------------------

create or replace function public.platform_blocked_plan_tiers()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select blocked_plan_tiers from public.platform_settings where id), array[]::text[]);
$$;

grant execute on function public.platform_blocked_plan_tiers() to authenticated, anon;

create or replace function public.founder_set_platform_blocked_plan_tiers(
  p_blocked_plan_tiers text[]
) returns text[] language plpgsql security definer set search_path = public as $$
declare
  before_tiers text[];
  next_tiers text[];
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not (p_blocked_plan_tiers <@ array['free', 'coach', 'coach_plus', 'club']::text[]) then
    raise exception 'Unknown plan tier' using errcode = '22023';
  end if;

  select blocked_plan_tiers into before_tiers from public.platform_settings where id for update;

  select coalesce(array_agg(distinct f order by f), array[]::text[]) into next_tiers
    from unnest(p_blocked_plan_tiers) f;

  if next_tiers = before_tiers then
    return before_tiers;
  end if;

  update public.platform_settings set blocked_plan_tiers = next_tiers, updated_at = now() where id;

  perform public.founder_write_audit(
    'update_platform_blocked_plan_tiers', null, 'Platform', null,
    jsonb_build_object('before', to_jsonb(before_tiers), 'after', to_jsonb(next_tiers)));

  return next_tiers;
end;
$$;

grant execute on function public.founder_set_platform_blocked_plan_tiers(text[]) to authenticated;
