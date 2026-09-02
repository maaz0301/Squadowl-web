-- guardian_leave_season(season_roster_id) — lets a guardian remove their own
-- athlete from a season's roster.
--
-- season_roster_write is staff-only (owner/admin/coach — see 0001_initial_schema.sql),
-- so a guardian has no RLS path to this table at all today; a plain DELETE from
-- the client removes nothing and still answers success, the same silent-no-op
-- failure mode remove_org_member() and update_org_member_role() were introduced
-- to fix (see the comment on remove_org_member in
-- 20260831000000_remove_org_member_rpc.sql). Running this as a SECURITY DEFINER
-- function lets it authorize the caller once against the specific roster row and
-- raise a real exception when nothing is removed.
--
-- Deleting the season_roster row is a plain DELETE, not a "removed" flag: a
-- guardian leaving is not data the coach's roster/reporting needs to retain (the
-- coach's own "Delete Season"/roster-remove actions are equally hard deletes),
-- and `on delete cascade` on event_availability.roster_id (0001_initial_schema.sql)
-- takes the athlete's RSVPs with it in the same statement — nothing else
-- references season_roster.id.
--
-- Authorization mirrors the guardian branch of can_access_athlete() and the
-- `mine` CTE in get_guardian_rosters() (20260817150000/20260817130000): linked by
-- guardian_user_id, or by guardian_email when the accounts were never linked up.
-- Reconstructed here for the same reason remove_org_member's admin check is
-- reconstructed rather than shared — this repo cannot see functions owned by the
-- backend repo. Diff against can_access_athlete()/get_guardian_rosters() if those
-- change.

create or replace function public.guardian_leave_season(p_season_roster_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_guardian_user_id uuid;
  v_guardian_email citext;
  v_caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  v_removed integer := 0;
begin
  select sr.athlete_id, a.guardian_user_id, a.guardian_email
    into v_athlete_id, v_guardian_user_id, v_guardian_email
  from public.season_roster sr
  join public.athletes a on a.id = sr.athlete_id
  where sr.id = p_season_roster_id;

  if v_athlete_id is null then
    raise exception 'Roster entry not found' using errcode = 'P0002';
  end if;

  if not (
    v_guardian_user_id = auth.uid()
    or (v_caller_email is not null and v_guardian_email = v_caller_email::citext)
  ) then
    raise exception 'Not authorized to leave this team' using errcode = '42501';
  end if;

  delete from public.season_roster where id = p_season_roster_id;
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'Could not leave this team' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.guardian_leave_season(uuid) from public;
grant execute on function public.guardian_leave_season(uuid) to authenticated;
