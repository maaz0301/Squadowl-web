-- update_tryout_player(uuid, jsonb, jsonb) — edit a player, as an assessor.
--
-- Reported by a client coach: signed in as an *assessor* on an evaluation,
-- Edit Player accepted their changes and reported nothing, but the player kept
-- the old values — for the coach and for the assessor's own re-opened form.
--
-- The cause is that an assessor reaches an evaluation through a
-- tryout_assessors row rather than a membership, and the `athletes` /
-- `tryout_participants` policies only admit staff on the owning account. An
-- UPDATE that RLS rejects is not an error in Postgres: it matches zero rows and
-- reports success, so updatePlayer() wrote nothing and then re-read the
-- unchanged row. (The same shape is already noted on getAiPlayerSummary() in
-- SupabaseDataSource.ts, which swallows it deliberately.) The client now
-- detects the refusal and calls this function, which does the write with an
-- authorization check that holds server-side.
--
-- Authorized:
--   1. staff on the account the evaluation belongs to (owner/admin/coach);
--   2. an assessor invited to it, in any role, who has not declined — this is
--      the new grant, and it matches the model the app already documents on
--      Tryout.viewerIsOwner: an invited assessor "may score players and edit
--      the roster";
--   3. a coach the evaluation's *team* reaches — CLUB-mode delegation, asked
--      through the deployed list_tryouts_for_managed_teams() /
--      list_tryouts_on_my_owned_teams() functions rather than by reading
--      team_managers, whose shape and policies live in the backend repo (same
--      reasoning as the note on soft_delete_tryout).
--
-- Everyone else — a guardian, a signed-in stranger — gets 42501.
--
-- SCOPE, deliberately chosen: the athlete half of the patch writes the
-- `athletes` row, which is global. An athlete carries one profile across every
-- evaluation and team they appear in, so an assessor invited to a single
-- evaluation who corrects a guardian email or medical note changes it
-- everywhere, including for other clubs. That is the grant that was asked for
-- (the alternative was to let an assessor edit only the per-evaluation
-- tryout_participants fields — jersey, position, shoots — and leave the shared
-- profile to the coach). If that trade is later judged too wide, narrow it by
-- dropping the athlete branch below rather than by hiding the button.
--
-- Both patches are the same column/value maps updatePlayer() already builds.
-- They are applied through jsonb_populate_record over the current row, so a key
-- that is absent keeps its value and a key that is present as null clears it —
-- matching what a direct PostgREST update did. Only the columns named in each
-- SET list are ever written, so a patch carrying `id`, `account_id` or any
-- other column it has no business setting cannot reach the table through here.
--
-- NOTE FOR REVIEW: the membership and assessor checks are reconstructed from
-- soft_delete_tryout() and get_session_progress_for_tryout() in this repo, not
-- copied from the `athletes` / `tryout_participants` policies, which live in
-- the backend repo and are the source of truth. Diff them before applying, and
-- confirm the column lists below still match those two tables. This function
-- only *widens* who can write, through a path the client falls back to; it
-- changes nothing about the direct-table policies, and an instance that has not
-- applied this migration keeps today's behaviour (the coach's edit works, the
-- assessor's is refused with a readable message).

create or replace function public.update_tryout_player(
  p_participant_id uuid,
  p_athlete_patch jsonb default '{}'::jsonb,
  p_participant_patch jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tryout_id uuid;
  v_athlete_id uuid;
  v_account_id uuid;
  v_allowed boolean := false;
  v_old_athlete public.athletes;
  v_new_athlete public.athletes;
  v_old_part public.tryout_participants;
  v_new_part public.tryout_participants;
begin
  select p.tryout_id, p.athlete_id
    into v_tryout_id, v_athlete_id
  from public.tryout_participants p
  where p.id = p_participant_id;

  if v_tryout_id is null then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  select t.account_id into v_account_id
  from public.tryouts t
  where t.id = v_tryout_id;

  -- 1. Staff on the account that owns the evaluation.
  select exists (
    select 1 from public.memberships m
    where m.account_id = v_account_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'coach')
  ) into v_allowed;

  -- 2. An invited assessor who has not declined.
  if not v_allowed then
    select exists (
      select 1 from public.tryout_assessors a
      where a.tryout_id = v_tryout_id
        and a.user_id = auth.uid()
        and coalesce(a.status, 'accepted') <> 'declined'
    ) into v_allowed;
  end if;

  -- 3. A coach who reaches it through the team. Asked dynamically so an
  --    instance that hasn't deployed these functions yet still gets 1 and 2
  --    rather than a function that won't create; any error from them is read as
  --    "not this way", never as a grant.
  if not v_allowed
     and to_regprocedure('public.list_tryouts_for_managed_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_for_managed_teams() t where t.id = $1)'
        into v_allowed using v_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed
     and to_regprocedure('public.list_tryouts_on_my_owned_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_on_my_owned_teams() t where t.id = $1)'
        into v_allowed using v_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed then
    raise exception 'You do not have permission to edit players on this evaluation'
      using errcode = '42501';
  end if;

  if coalesce(p_athlete_patch, '{}'::jsonb) <> '{}'::jsonb and v_athlete_id is not null then
    select * into v_old_athlete from public.athletes where id = v_athlete_id;
    if found then
      v_new_athlete := jsonb_populate_record(v_old_athlete, p_athlete_patch);
      update public.athletes set
        first_name       = v_new_athlete.first_name,
        last_name        = v_new_athlete.last_name,
        year_of_birth    = v_new_athlete.year_of_birth,
        guardian_name    = v_new_athlete.guardian_name,
        guardian_email   = v_new_athlete.guardian_email,
        guardian_phone   = v_new_athlete.guardian_phone,
        player_email     = v_new_athlete.player_email,
        medical_info     = v_new_athlete.medical_info,
        about            = v_new_athlete.about,
        default_position = v_new_athlete.default_position,
        avatar_url       = v_new_athlete.avatar_url
      where id = v_athlete_id;
    end if;
  end if;

  if coalesce(p_participant_patch, '{}'::jsonb) <> '{}'::jsonb then
    select * into v_old_part from public.tryout_participants where id = p_participant_id;
    v_new_part := jsonb_populate_record(v_old_part, p_participant_patch);
    update public.tryout_participants set
      jersey                  = v_new_part.jersey,
      jersey_colour           = v_new_part.jersey_colour,
      position                = v_new_part.position,
      shoots                  = v_new_part.shoots,
      position_trying_out_for = v_new_part.position_trying_out_for,
      current_team            = v_new_part.current_team,
      current_level           = v_new_part.current_level,
      anonymous               = v_new_part.anonymous,
      sort_out                = v_new_part.sort_out,
      waiver_accepted_at      = v_new_part.waiver_accepted_at,
      friend1_name            = v_new_part.friend1_name,
      friend2_name            = v_new_part.friend2_name,
      assigned_assessor_id    = v_new_part.assigned_assessor_id
    where id = p_participant_id;
  end if;
end;
$$;

revoke all on function public.update_tryout_player(uuid, jsonb, jsonb) from public;
grant execute on function public.update_tryout_player(uuid, jsonb, jsonb) to authenticated;
