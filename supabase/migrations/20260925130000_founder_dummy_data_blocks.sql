-- Founder console: turn the dummy-data testing tools off per plan tier.
--
-- The dummy-data generators (roster players, registrations, whole teams) are
-- available on every plan while the product is being tested. This gives the
-- founder — and only the founder — a switch to disable them for all plans or
-- for individual ones. Same shape as platform_settings.blocked_plan_tiers
-- (20260923120000_founder_feature_blocks.sql), and like it a UI-level gate the
-- apps check to hide the tools, not a data boundary enforced by RLS.
--
-- Requires 20260923120000_founder_feature_blocks.sql (creates platform_settings).

alter table public.platform_settings
  add column if not exists dummy_data_blocked_plan_tiers text[] not null default '{}'::text[];

alter table public.platform_settings
  drop constraint if exists platform_settings_dummy_data_blocked_plan_tiers_valid;
alter table public.platform_settings
  add constraint platform_settings_dummy_data_blocked_plan_tiers_valid
  check (dummy_data_blocked_plan_tiers <@ array['free', 'coach', 'coach_plus', 'club']::text[]);

comment on column public.platform_settings.dummy_data_blocked_plan_tiers is
  'Plan tiers the dummy-data testing tools are switched off for. Empty (the default) means available on every plan.';

-- The audit log's `action` column is a fixed check constraint; the new action
-- kind has to be added to it or the insert in the function below fails.
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
    'update_platform_blocked_features', 'update_platform_blocked_plan_tiers',
    'update_dummy_data_blocked_plan_tiers'
  ));

-- Every signed-in screen reads this to decide whether to show the tools, so —
-- like platform_blocked_plan_tiers() — it is not restricted to the founder.
create or replace function public.platform_dummy_data_blocked_plan_tiers()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select dummy_data_blocked_plan_tiers from public.platform_settings where id), array[]::text[]);
$$;

grant execute on function public.platform_dummy_data_blocked_plan_tiers() to authenticated, anon;

-- Replaces the whole set at once (the console edits it as a checkbox group).
create or replace function public.founder_set_dummy_data_blocked_plan_tiers(
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

  select dummy_data_blocked_plan_tiers into before_tiers from public.platform_settings where id for update;

  select coalesce(array_agg(distinct f order by f), array[]::text[]) into next_tiers
    from unnest(p_blocked_plan_tiers) f;

  if next_tiers = before_tiers then
    return before_tiers;
  end if;

  update public.platform_settings set dummy_data_blocked_plan_tiers = next_tiers, updated_at = now() where id;

  perform public.founder_write_audit(
    'update_dummy_data_blocked_plan_tiers', null, 'Platform', null,
    jsonb_build_object('before', to_jsonb(before_tiers), 'after', to_jsonb(next_tiers)));

  return next_tiers;
end;
$$;

grant execute on function public.founder_set_dummy_data_blocked_plan_tiers(text[]) to authenticated;
