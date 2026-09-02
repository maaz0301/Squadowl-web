-- A player on a team's roster is invisible to their own guardian.
--
-- Everything the guardian portal renders — the team, the schedule, RSVPs, fees,
-- the team chat — hangs off `season_roster`. get_guardian_rosters()
-- (20260817130000) reads it, and can_access_season() (20260818120000) is what
-- admits a guardian to the chat at all. Nothing guardian-facing reads
-- `team_roster`.
--
-- But the coach's "add to roster" writes `team_roster`, and the season roster was
-- only ever synced from it at three moments, all of them client-side:
-- createSeason() seeding from linked assessments, the first event save
-- (useAddTeamEventMutation), and turning fees on (useUpdateTeamMutation). A player
-- added to a team whose season already existed hit none of them. The coach saw
-- them on the roster; their guardian's portal said "This athlete isn't assigned to
-- any tryouts or seasons yet", which was accurate — nobody had enrolled them.
--
-- Enforced here rather than in the apps because both clients (the React Native app
-- and the Next.js web app) have their own copies of every one of those add paths,
-- and each one that forgets reintroduces the bug for a roster the *other* client
-- can see. A trigger makes "on the team roster" imply "on the team's season" for
-- every writer — bulk imports and manual adds alike — the same way
-- prune_stale_event_invites (20260828120000) keeps invites honest.

-- Provisioning a season when the team hasn't got one mirrors what the clients
-- already do in the three paths above. Seasons are an implementation detail the
-- coach-facing UI never names ("Events live on the season attached to this team"),
-- so a team that simply hasn't scheduled anything yet must not be the reason a
-- guardian can't see their own player.
create or replace function public.ensure_team_season_enrollment()
returns trigger
language plpgsql
-- SECURITY DEFINER because season_roster_write and seasons' own policies are
-- staff-only against the *season's* account, and in CLUB mode a delegated team's
-- season can sit under a different account_id than the caller holds a membership
-- of (see list_seasons_for_managed_teams). The caller already proved they may
-- write this team's roster — team_roster_write ran before this trigger fired.
security definer
set search_path = public
as $$
declare
  v_season_id uuid;
  v_account_id uuid;
  v_team_name text;
begin
  -- Newest non-archived season for the team, which is the one the clients resolve
  -- to: listSeasons() filters archived and orders created_at desc, and every
  -- caller takes the first match on team_id.
  select s.id into v_season_id
    from public.seasons s
   where s.team_id = new.team_id
     and s.archived = false
   order by s.created_at desc
   limit 1;

  if v_season_id is null then
    select t.account_id, t.name into v_account_id, v_team_name
      from public.teams t
     where t.id = new.team_id;

    -- The team is gone from under us; the FK will reject the row anyway.
    if v_account_id is null then
      return new;
    end if;

    -- Same shape the clients create: "<Team> Season", team's own name, Hockey.
    insert into public.seasons (account_id, team_id, name, team_name, sport)
    values (v_account_id, new.team_id, v_team_name || ' Season', v_team_name, 'Hockey')
    returning id into v_season_id;
  end if;

  -- do nothing, not an upsert: an athlete already enrolled keeps their existing
  -- row — jersey, player_email, and the fee status hanging off it
  -- (20260811183700_season_team_fee_payments.sql). This is a "make sure they're
  -- on the season" write, not an edit, matching addSeasonPlayers()'s
  -- ignoreDuplicates.
  insert into public.season_roster (season_id, athlete_id, jersey)
  values (v_season_id, new.athlete_id, new.jersey)
  on conflict (season_id, athlete_id) do nothing;

  return new;
end;
$$;

drop trigger if exists team_roster_season_enrollment on public.team_roster;
create trigger team_roster_season_enrollment
  after insert on public.team_roster
  for each row execute function public.ensure_team_season_enrollment();

-- Back-fill everyone already stranded on a team roster. Without this the fix only
-- helps players added from here on, and every athlete added to a team since the
-- season was provisioned stays invisible to their guardian until somebody happens
-- to save an event on that team.
do $$
declare
  v_team record;
  v_season_id uuid;
begin
  for v_team in
    select distinct tr.team_id from public.team_roster tr
  loop
    select s.id into v_season_id
      from public.seasons s
     where s.team_id = v_team.team_id
       and s.archived = false
     order by s.created_at desc
     limit 1;

    if v_season_id is null then
      insert into public.seasons (account_id, team_id, name, team_name, sport)
      select t.account_id, t.id, t.name || ' Season', t.name, 'Hockey'
        from public.teams t
       where t.id = v_team.team_id
      returning id into v_season_id;
    end if;

    if v_season_id is null then
      continue;
    end if;

    insert into public.season_roster (season_id, athlete_id, jersey)
    select v_season_id, tr.athlete_id, tr.jersey
      from public.team_roster tr
     where tr.team_id = v_team.team_id
    on conflict (season_id, athlete_id) do nothing;
  end loop;
end;
$$;
