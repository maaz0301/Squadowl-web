-- create_athlete_for_tryout() / create_athlete_for_team() — put a newly created
-- athlete on the account that owns the roster, not the account of whoever typed
-- it in.
--
-- Reported by a client coach: a player added by an *assessor* showed up in full
-- for the assessor, and as "Unknown Player" with no birth year, no guardian and
-- no photo for the coach who owns the evaluation. Same player, same row, two
-- different answers.
--
-- The cause is that adding a player writes two rows, and only one of them is
-- keyed to the evaluation. `tryout_participants` carries tryout_id, so its
-- policy admits an invited assessor and the row lands where everyone can see
-- it. The `athletes` row carries an account_id, and it is created through
-- create_athlete_for_caller(), which — by design, to survive a stale cached
-- account — resolves that account from auth.uid() server-side. For an assessor
-- who is a coach somewhere else, auth.uid() resolves to *their* club, so the
-- athlete is filed under a club that has nothing to do with the evaluation.
-- The owner can then read the participant row and not the athlete row it points
-- at, and rowToPlayer() renders the empty join as "Unknown Player".
--
-- Nothing was broken about create_athlete_for_caller(); it answers the question
-- it was asked. These two functions ask the other question — "which account
-- owns the thing this athlete is being added to?" — and are used by the client
-- only when the two answers differ. A coach adding a player to their own
-- evaluation still goes through create_athlete_for_caller() and touches none of
-- this.
--
-- Authorized, for the tryout function — the same ladder as
-- update_tryout_player() (20260909120000), which is the closest precedent: it
-- also lets an assessor write a row the table's own policies would refuse.
--   1. staff on the account the evaluation belongs to (owner/admin/coach);
--   2. an assessor invited to it, in any role, who has not declined;
--   3. a coach the evaluation's team reaches — CLUB-mode delegation, asked
--      through the deployed list_tryouts_for_managed_teams() /
--      list_tryouts_on_my_owned_teams() functions rather than by reading
--      team_managers, whose shape and policies live in the backend repo.
--
-- For the team function:
--   1. staff on the account the team belongs to;
--   2. a manager the team is delegated to, via list_teams_managed_by_me().
--
-- Everyone else — a guardian, a signed-in stranger — gets 42501.
--
-- SCOPE: this creates an athlete on an account the caller may not be a member
-- of. That is the point, and it is narrower than it sounds — the caller has to
-- already hold a grant over the specific evaluation or team, and the only row
-- they can create is one they are about to attach to it. The columns below are
-- an allow-list, so a payload carrying `id`, `account_id` or any other column
-- it has no business setting cannot reach the table through here; account_id
-- is taken from the tryout/team and never from the payload.
--
-- NOTE FOR REVIEW: the membership and assessor checks are reconstructed from
-- update_tryout_player() and athlete_is_reachable() in this repo, not copied
-- from the `athletes` policies, which live in the backend repo and are the
-- source of truth. Diff them before applying, and confirm the column list below
-- still matches `athletes`. An instance that has not applied this migration
-- keeps today's behaviour on the coach path; the assessor path reports that it
-- cannot add the player rather than filing it under the wrong account.

create or replace function public.create_athlete_row(
  p_account_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_new public.athletes;
  v_id uuid;
begin
  -- jsonb_populate_record over an empty row, so a key that is absent stays
  -- null and only the columns named below are ever written.
  v_new := jsonb_populate_record(null::public.athletes, coalesce(p_payload, '{}'::jsonb));

  insert into public.athletes (
    account_id,
    first_name,
    last_name,
    year_of_birth,
    guardian_name,
    guardian_email,
    guardian_phone,
    guardian_user_id,
    player_email,
    medical_info,
    about,
    default_position,
    avatar_url
  ) values (
    p_account_id,
    v_new.first_name,
    v_new.last_name,
    v_new.year_of_birth,
    v_new.guardian_name,
    v_new.guardian_email,
    v_new.guardian_phone,
    v_new.guardian_user_id,
    v_new.player_email,
    v_new.medical_info,
    v_new.about,
    v_new.default_position,
    v_new.avatar_url
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Internal helper only: it does no authorization of its own, so nobody outside
-- the two functions below may call it.
revoke all on function public.create_athlete_row(uuid, jsonb) from public;


create or replace function public.create_athlete_for_tryout(
  p_tryout_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_allowed boolean := false;
begin
  select t.account_id into v_account_id
  from public.tryouts t
  where t.id = p_tryout_id;

  if v_account_id is null then
    raise exception 'Assessment not found' using errcode = 'P0002';
  end if;

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
      where a.tryout_id = p_tryout_id
        and a.user_id = auth.uid()
        and coalesce(a.status, 'accepted') <> 'declined'
    ) into v_allowed;
  end if;

  -- 3. A coach who reaches it through the team. Asked dynamically so an
  --    instance that hasn't deployed these functions yet still gets 1 and 2;
  --    any error from them is read as "not this way", never as a grant.
  if not v_allowed
     and to_regprocedure('public.list_tryouts_for_managed_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_for_managed_teams() t where t.id = $1)'
        into v_allowed using p_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed
     and to_regprocedure('public.list_tryouts_on_my_owned_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_on_my_owned_teams() t where t.id = $1)'
        into v_allowed using p_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed then
    raise exception 'You do not have permission to add players to this evaluation'
      using errcode = '42501';
  end if;

  return public.create_athlete_row(v_account_id, p_payload);
end;
$$;

revoke all on function public.create_athlete_for_tryout(uuid, jsonb) from public;
grant execute on function public.create_athlete_for_tryout(uuid, jsonb) to authenticated;


create or replace function public.create_athlete_for_team(
  p_team_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_allowed boolean := false;
begin
  select t.account_id into v_account_id
  from public.teams t
  where t.id = p_team_id;

  if v_account_id is null then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  -- 1. Staff on the account that owns the team.
  select exists (
    select 1 from public.memberships m
    where m.account_id = v_account_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'coach')
  ) into v_allowed;

  -- 2. A manager the team itself is delegated to.
  if not v_allowed
     and to_regprocedure('public.list_teams_managed_by_me()') is not null then
    begin
      execute 'select exists (select 1 from public.list_teams_managed_by_me() t where t.id = $1)'
        into v_allowed using p_team_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed then
    raise exception 'You do not have permission to add players to this team'
      using errcode = '42501';
  end if;

  return public.create_athlete_row(v_account_id, p_payload);
end;
$$;

revoke all on function public.create_athlete_for_team(uuid, jsonb) from public;
grant execute on function public.create_athlete_for_team(uuid, jsonb) to authenticated;
