-- "Leave Team" left the athlete on the team.
--
-- guardian_leave_season() (20260902120000) deleted the season_roster row and
-- stopped there, which was enough when season_roster was the only thing anyone
-- enrolled into. It isn't any more: team_roster_season_enrollment
-- (20260902130000) makes "on the team roster" imply "on the team's season", and
-- syncSeasonRosterFromTeam() re-adds every team_roster athlete missing from the
-- season on each event save. So a guardian who left was still on the coach's
-- roster and got silently re-enrolled — schedule, chat and RSVPs back — the next
-- time the coach saved anything.
--
-- Leaving now removes the team_roster row too, which is also what the button says
-- it does ("Leave Team", "Remove this athlete from <team>? You'll need a new
-- invite to rejoin"). With that row gone nothing re-enrolls them: the sync only
-- ever adds athletes who are on the team roster, and the trigger only fires on
-- insert.
--
-- Also clears the athlete out of the team's *other* non-archived seasons. A team
-- normally has one, but leaving a team while staying enrolled in another of its
-- seasons would keep exactly the access — the team chat especially, which
-- can_access_season() grants per season — that leaving is meant to end.
--
-- Authorization and the hard-delete rationale are unchanged from
-- 20260902120000_guardian_leave_season.sql; see that file.

create or replace function public.guardian_leave_season(p_season_roster_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_season_id uuid;
  v_team_id uuid;
  v_guardian_user_id uuid;
  v_guardian_email citext;
  v_caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  v_removed integer := 0;
begin
  select sr.athlete_id, sr.season_id, se.team_id, a.guardian_user_id, a.guardian_email
    into v_athlete_id, v_season_id, v_team_id, v_guardian_user_id, v_guardian_email
  from public.season_roster sr
  join public.seasons se on se.id = sr.season_id
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

  -- A season with no team is a standalone season; there is no roster to leave.
  if v_team_id is not null then
    delete from public.team_roster
     where team_id = v_team_id
       and athlete_id = v_athlete_id;

    delete from public.season_roster sr
     using public.seasons se
     where sr.season_id = se.id
       and se.team_id = v_team_id
       and se.archived = false
       and sr.athlete_id = v_athlete_id;
  end if;
end;
$$;

revoke all on function public.guardian_leave_season(uuid) from public;
grant execute on function public.guardian_leave_season(uuid) to authenticated;
