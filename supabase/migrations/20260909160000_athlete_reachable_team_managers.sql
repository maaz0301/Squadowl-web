-- athlete_is_reachable(uuid) — let a delegated team manager reach the athletes
-- on their own team.
--
-- The helper behind list_athlete_family_contacts(),
-- add_athlete_family_contact() and remove_athlete_family_contact() (see
-- 20260909130000 and 20260909140000) admits two kinds of caller: staff on the
-- athlete's account, and an assessor invited to a tryout the athlete plays in.
-- A CLUB-mode team manager is neither. They hold no membership on the club's
-- account — the grant lives in `team_managers` against one team — so a manager
-- running a team could not read, add or remove a family contact on their own
-- players.
--
-- This is the same gap 20260909150000 closed on the evaluations read, in the
-- same place: an authorization clause written before delegation existed, which
-- asks about accounts when the question is about a team.
--
-- It is also why this misbehaves *inconsistently* from the outside. A manager
-- who happens to also be on the assessor list for the tryout passes through
-- the second branch already and sees everything; a manager who was only handed
-- the team fails. Same person, same team, different answer depending on
-- whether someone thought to add them as an assessor too.
--
-- Authorized after this:
--   1. staff on the athlete's account — unchanged;
--   2. an assessor invited (not declined) to a tryout the athlete plays in —
--      unchanged;
--   3. a coach who reaches the athlete through a team. Two ways in, because an
--      athlete reaches a team by two routes: playing in an assessment on it,
--      and sitting on its roster. Both directions of the delegation are asked
--      (a team delegated to the caller, and the caller's own team that a
--      delegate created on) for the same reason 20260909150000 asks both:
--      createTryout() stamps the *creator's* account on the tryout and the
--      athletes it creates, so which side of the delegation can see a row
--      depends on who happened to make it.
--
-- Asked through the deployed list_tryouts_for_managed_teams() /
-- list_tryouts_on_my_owned_teams() / list_teams_managed_by_me() functions
-- rather than by reading `team_managers`, whose shape and policies live in the
-- backend repo (same reasoning as the note on soft_delete_tryout), and asked
-- dynamically so an instance that has not deployed them still gets 1 and 2.
-- Any error from them is read as "not this way", never as a grant.
--
-- NOTE FOR REVIEW: this helper gates three `security definer` functions, so
-- widening it widens all three at once — read, add and remove. Reconstructed
-- from this repo, not copied from the `athlete_family_contacts` / `athletes`
-- policies, which live in the backend repo and are the source of truth; diff
-- before applying. Depends on 20260909130000; apply that one first.

create or replace function public.athlete_is_reachable(p_athlete_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed boolean := false;
begin
  -- 1. Staff on the account the athlete belongs to.
  select exists (
    select 1
    from public.athletes a
    join public.memberships m on m.account_id = a.account_id
    where a.id = p_athlete_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'coach')
  ) into v_allowed;

  -- 2. An assessor invited to a tryout this athlete participates in.
  if not v_allowed then
    select exists (
      select 1
      from public.tryout_participants tp
      join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
      where tp.athlete_id = p_athlete_id
        and ta.user_id = auth.uid()
        and coalesce(ta.status, 'accepted') <> 'declined'
    ) into v_allowed;
  end if;

  -- 3a. Plays in an assessment the caller reaches through the team.
  if not v_allowed
     and to_regprocedure('public.list_tryouts_for_managed_teams()') is not null then
    begin
      execute 'select exists (
                 select 1
                 from public.tryout_participants tp
                 join public.list_tryouts_for_managed_teams() t on t.id = tp.tryout_id
                where tp.athlete_id = $1)'
        into v_allowed using p_athlete_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed
     and to_regprocedure('public.list_tryouts_on_my_owned_teams()') is not null then
    begin
      execute 'select exists (
                 select 1
                 from public.tryout_participants tp
                 join public.list_tryouts_on_my_owned_teams() t on t.id = tp.tryout_id
                where tp.athlete_id = $1)'
        into v_allowed using p_athlete_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  -- 3b. On the roster of a team delegated to the caller. Separate from 3a
  --     because a player can be on the team without having been carried into
  --     an assessment yet — which is exactly when a coach is filling in their
  --     family contacts.
  if not v_allowed
     and to_regprocedure('public.list_teams_managed_by_me()') is not null then
    begin
      execute 'select exists (
                 select 1
                 from public.team_roster tr
                 join public.list_teams_managed_by_me() t on t.id = tr.team_id
                where tr.athlete_id = $1)'
        into v_allowed using p_athlete_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  return v_allowed;
end;
$$;

revoke all on function public.athlete_is_reachable(uuid) from public;
grant execute on function public.athlete_is_reachable(uuid) to authenticated;
