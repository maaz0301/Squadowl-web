-- A guardian leaving a team must not remove the player from the coach's roster.
--
-- guardian_leave_season() deleted the team_roster row as well as the guardian's
-- own season_roster rows (20260902140000), so the player vanished from the
-- coach's team screen. Only a coach should be able to take a player off the
-- roster. The reason the roster row was deleted at all was to stop the player
-- being enrolled straight back into the season: team_roster implies season
-- enrolment through ensure_team_season_enrollment() and through the apps' own
-- syncs on event save.
--
-- Now leaving removes only what the guardian sees (the season_roster rows:
-- schedule, RSVPs, team chat) and records the opt-out. A BEFORE INSERT guard on
-- season_roster skips any enrolment for an opted-out (team, athlete), whichever
-- writer attempts it, so nothing re-enrols them. The opt-out is cleared when a
-- coach removes the player from the team roster, so adding them again later is
-- a fresh start.
--
-- team_roster is untouched: the coach's roster, jersey, position and records
-- stay exactly as they were.

create table if not exists public.guardian_team_optouts (
  team_id    uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, athlete_id)
);

-- Only the SECURITY DEFINER functions below touch this table.
alter table public.guardian_team_optouts enable row level security;

create or replace function public.skip_opted_out_season_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.guardian_team_optouts o
      join public.seasons s on s.team_id = o.team_id
     where s.id = new.season_id
       and o.athlete_id = new.athlete_id
  ) then
    -- Skip this row quietly; the guardian chose to leave this team.
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists season_roster_skip_optout on public.season_roster;
create trigger season_roster_skip_optout
  before insert on public.season_roster
  for each row execute function public.skip_opted_out_season_roster();

create or replace function public.clear_optout_on_team_roster_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.guardian_team_optouts
   where team_id = old.team_id
     and athlete_id = old.athlete_id;
  return old;
end;
$$;

drop trigger if exists team_roster_clear_optout on public.team_roster;
create trigger team_roster_clear_optout
  after delete on public.team_roster
  for each row execute function public.clear_optout_on_team_roster_delete();

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

  -- coalesce: with a null guardian_user_id or guardian_email the comparisons are
  -- NULL, and `if not (NULL)` is NULL (not true), which would let anyone through.
  if not (
    coalesce(v_guardian_user_id = auth.uid(), false)
    or coalesce(v_caller_email is not null and v_guardian_email = v_caller_email::citext, false)
  ) then
    raise exception 'Not authorized to leave this team' using errcode = '42501';
  end if;

  -- Record the opt-out first, so the delete below cannot be undone by a sync
  -- that runs in between. A season with no team is a standalone season; there
  -- is no coach roster to protect, so it is simply removed.
  if v_team_id is not null then
    insert into public.guardian_team_optouts (team_id, athlete_id)
    values (v_team_id, v_athlete_id)
    on conflict do nothing;
  end if;

  delete from public.season_roster where id = p_season_roster_id;
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'Could not leave this team' using errcode = 'P0002';
  end if;

  -- The team's other live seasons too: staying enrolled in one would keep the
  -- access (the team chat especially) that leaving is meant to end.
  if v_team_id is not null then
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
revoke execute on function public.guardian_leave_season(uuid) from anon;
grant execute on function public.guardian_leave_season(uuid) to authenticated;
