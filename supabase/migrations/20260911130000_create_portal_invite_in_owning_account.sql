-- create_portal_invite_for_tryout() / create_portal_invite_for_team() — let an
-- assessor or delegated manager actually send the portal invite the app
-- already tries to send on their behalf.
--
-- Reported by a client coach testing in assessor mode: adding a player worked
-- (20260911120000 covers that), but the automatic invite that follows failed
-- with "new row violates row-level security policy for table portal_invites".
-- `sendTryoutRosterInvites()`/`sendTeamRosterInvites()` insert directly into
-- `portal_invites` with `account_id` set to the evaluation's or team's owning
-- account — correct, per the comment already on that code, "portal_invites is
-- keyed to the row it's about" — but the table's own INSERT policy (in the
-- backend repo) requires a `memberships` row with owner/admin/coach on that
-- account. An invited assessor has no membership at all, reached only through
-- `tryout_assessors`; a delegated CLUB-mode manager has no membership on the
-- club whose team they run. Same shape as 20260911120000, one step later in
-- the same flow: the write that names the right account still needs a grant
-- the table's policy doesn't extend to non-staff.
--
-- Authorized: identical ladders to create_athlete_for_tryout/for_team in
-- 20260911120000 — staff on the owning account, an invited assessor who has
-- not declined (tryout only), and a coach delegated the team (both). Everyone
-- else gets 42501.
--
-- SCOPE: like the athlete functions, these create exactly the row the caller
-- was already entitled to trigger through the UI — one invite, to an address
-- pulled off an athlete on a roster they may already edit. account_id is taken
-- from the tryout/team, never from the caller.
--
-- NOTE FOR REVIEW: reconstructed from create_athlete_for_tryout/for_team in
-- this repo, not copied from the `portal_invites` policies, which live in the
-- backend repo and are the source of truth — diff before applying. An instance
-- that has not applied this migration keeps today's behaviour: the coach path
-- (account_id already equals the caller's own) is unaffected; the assessor and
-- delegated-manager paths report the invite as failed for that address, same
-- as before, rather than silently succeeding.

create or replace function public.create_portal_invite_for_tryout(
  p_tryout_id uuid,
  p_athlete_id uuid,
  p_email text,
  p_token text
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
  v_id uuid;
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
    raise exception 'You do not have permission to invite players on this evaluation'
      using errcode = '42501';
  end if;

  insert into public.portal_invites (account_id, athlete_id, email, token)
  values (v_account_id, p_athlete_id, p_email, p_token)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_portal_invite_for_tryout(uuid, uuid, text, text) from public;
grant execute on function public.create_portal_invite_for_tryout(uuid, uuid, text, text) to authenticated;


create or replace function public.create_portal_invite_for_team(
  p_team_id uuid,
  p_athlete_id uuid,
  p_email text,
  p_token text
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
  v_id uuid;
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
    raise exception 'You do not have permission to invite players on this team'
      using errcode = '42501';
  end if;

  insert into public.portal_invites (account_id, athlete_id, team_id, email, token)
  values (v_account_id, p_athlete_id, p_team_id, p_email, p_token)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_portal_invite_for_team(uuid, uuid, text, text) from public;
grant execute on function public.create_portal_invite_for_team(uuid, uuid, text, text) to authenticated;
