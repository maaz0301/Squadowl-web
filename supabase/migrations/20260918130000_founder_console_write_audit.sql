-- Founder console: audit direct table writes.
--
-- Every action in founderWrites.ts (team/player/season/evaluation/assessor
-- edits and deletes) goes straight to the table under RLS, the same way the
-- comment at the top of that file explains — no RPC, no founder_write_audit()
-- call, because that helper is internal to SECURITY DEFINER functions. These
-- writes were the one part of the founder console that left no audit trail.
--
-- Harmless while founder@tryout.ca is the only one who can reach the console,
-- but once a second admin gets access, a silent team/player/evaluation edit
-- with no record of who made it becomes a real problem.
--
-- Builds on 20260916120000_founder_org_management.sql (founder_audit_log,
-- founder_write_audit(), is_founder()).

-- ---------------------------------------------------------------------------
-- Audit log: new action kinds
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
    'refund_payment', 'change_subscription', 'cancel_subscription', 'resume_subscription',
    'delete_support_ticket',
    'update_team', 'archive_team', 'unarchive_team',
    'update_player', 'add_player_to_team', 'update_team_roster', 'remove_player_from_team',
    'update_season', 'archive_season', 'unarchive_season',
    'add_season_event', 'update_season_event', 'delete_season_event',
    'update_tryout', 'archive_tryout', 'unarchive_tryout', 'delete_tryout', 'restore_tryout',
    'add_player_to_tryout', 'update_participant', 'remove_participant', 'restore_participant',
    'update_assessor', 'remove_assessor',
    'update_evaluation', 'delete_evaluation'
  ));

-- ---------------------------------------------------------------------------
-- Client-callable logging RPC
-- ---------------------------------------------------------------------------

-- founder_write_audit() stays revoked from authenticated (see
-- 20260916120000_founder_org_management.sql), so this is a whitelisted,
-- is_founder()-gated wrapper the client can call right after a direct write
-- lands. The account name is looked up here rather than trusted from the
-- client, the same way every SECURITY DEFINER audit call in this file reads
-- it off the row it just touched.
create or replace function public.founder_log_console_write(
  p_action text,
  p_account_id uuid,
  p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, auth as $$
declare
  v_account_name text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_action not in (
    'update_team', 'archive_team', 'unarchive_team',
    'update_player', 'add_player_to_team', 'update_team_roster', 'remove_player_from_team',
    'update_season', 'archive_season', 'unarchive_season',
    'add_season_event', 'update_season_event', 'delete_season_event',
    'update_tryout', 'archive_tryout', 'unarchive_tryout', 'delete_tryout', 'restore_tryout',
    'add_player_to_tryout', 'update_participant', 'remove_participant', 'restore_participant',
    'update_assessor', 'remove_assessor',
    'update_evaluation', 'delete_evaluation'
  ) then
    raise exception 'Unsupported action' using errcode = '22023';
  end if;

  select name into v_account_name from public.accounts where id = p_account_id;

  perform public.founder_write_audit(p_action, p_account_id, v_account_name, null, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke all on function public.founder_log_console_write(text, uuid, jsonb) from public, anon;
grant execute on function public.founder_log_console_write(text, uuid, jsonb) to authenticated;
