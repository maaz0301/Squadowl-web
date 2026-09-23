-- ============================================================================
-- Team manager invites that wait for the invitee
-- ----------------------------------------------------------------------------
-- Delegating a team to an address with no account used to fail with 'User not
-- found'. Now the invite is saved against the e-mail address and turned into a
-- real team_managers row the moment an account with that address is created
-- (trigger on public.profiles), so access is in place on first sign-in.
--
--   * team_manager_invites            — the waiting invite (team, email, role).
--   * invite_team_manager_by_email()  — existing account: delegate now, as
--                                       before. No account: save an invite.
--   * claim_team_manager_invites()    — waiting invites -> team_managers rows.
--   * trigger on public.profiles      — runs the claim at sign-up.
--   * list_team_managers()            — also lists waiting invites (pending).
--   * remove_team_manager()           — accepts either kind of id.
--
-- Deliberately does NOT rewrite handle_new_user(): that function has been
-- replaced wholesale by CREATE OR REPLACE before, silently dropping earlier
-- behaviour (see 20260904120000_restore_signup_invite_claim). A separate
-- trigger cannot be lost that way.
-- ============================================================================

create table if not exists public.team_manager_invites (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  email      text not null,
  role       team_manager_role not null default 'manager',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists team_manager_invites_team_email_key
  on public.team_manager_invites (team_id, lower(email));
create index if not exists team_manager_invites_email_idx
  on public.team_manager_invites (lower(email));

alter table public.team_manager_invites enable row level security;

drop policy if exists team_manager_invites_staff on public.team_manager_invites;
create policy team_manager_invites_staff on public.team_manager_invites
  for all using (public.can_delegate_team(team_id))
  with check (public.can_delegate_team(team_id));

-- ----------------------------------------------------------------------------
-- Claim
-- ----------------------------------------------------------------------------
create or replace function public.claim_team_manager_invites(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null or btrim(p_email) = '' then
    return;
  end if;

  -- Someone already staff on the team's account has every team through their
  -- membership; the invite RPC refuses that case too, so those are dropped.
  insert into public.team_managers (team_id, user_id, role, invited_by)
  select i.team_id, p_user, i.role, i.invited_by
  from public.team_manager_invites i
  join public.teams te on te.id = i.team_id
  where lower(i.email) = lower(btrim(p_email))
    and not exists (
      select 1 from public.memberships m
      where m.account_id = te.account_id
        and m.user_id = p_user
        and m.role = any (array['owner','admin','coach']::membership_role[])
    )
    and not exists (
      select 1 from public.team_managers tm
      where tm.team_id = i.team_id and tm.user_id = p_user
    );

  delete from public.team_manager_invites
  where lower(email) = lower(btrim(p_email));
end;
$$;

-- Takes a user id, so it must not be callable from the client.
revoke all on function public.claim_team_manager_invites(uuid, text) from public, anon, authenticated;

create or replace function public.trg_claim_team_manager_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sign-up must never fail because of an invite; if the claim errors the
  -- account is still created and the invite stays waiting.
  begin
    perform public.claim_team_manager_invites(new.id, new.email);
  exception when others then
    raise warning 'claim_team_manager_invites failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists claim_team_manager_invites_on_profile on public.profiles;
create trigger claim_team_manager_invites_on_profile
  after insert on public.profiles
  for each row execute function public.trg_claim_team_manager_invites();

-- ----------------------------------------------------------------------------
-- Invite
-- ----------------------------------------------------------------------------
create or replace function public.invite_team_manager_by_email(
  team_uuid    uuid,
  lookup_email text,
  manager_role text default 'manager'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email    text := lower(btrim(lookup_email));
  target_user_id uuid;
  target_name    text;
  target_email   text;
  new_id         uuid;
begin
  if not public.can_delegate_team(team_uuid) then
    raise exception 'Not authorized to delegate this team';
  end if;

  if clean_email is null or clean_email = '' then
    raise exception 'Enter an email address';
  end if;

  select id, display_name, email
    into target_user_id, target_name, target_email
  from public.profiles
  where lower(email) = clean_email;

  -- No account yet: save the invite; the trigger on profiles claims it at sign-up.
  if target_user_id is null then
    select id into new_id
    from public.team_manager_invites
    where team_id = team_uuid and lower(email) = clean_email;

    if new_id is not null then
      update public.team_manager_invites
         set role = manager_role::team_manager_role
       where id = new_id;
    else
      insert into public.team_manager_invites (team_id, email, role, invited_by)
      values (team_uuid, clean_email, manager_role::team_manager_role, auth.uid())
      returning id into new_id;
    end if;

    return json_build_object(
      'id',      new_id,
      'teamId',  team_uuid,
      'userId',  null,
      'role',    manager_role,
      'email',   clean_email,
      'name',    null,
      'pending', true
    );
  end if;

  if exists (
    select 1 from public.teams te
    join public.memberships m on m.account_id = te.account_id
    where te.id = team_uuid
      and m.user_id = target_user_id
      and m.role = any (array['owner','admin','coach']::membership_role[])
  ) then
    raise exception 'That person is already staff on this account and can manage every team';
  end if;

  select id into new_id
  from public.team_managers
  where team_id = team_uuid and user_id = target_user_id;

  if new_id is not null then
    update public.team_managers
       set role = manager_role::team_manager_role
     where id = new_id;
  else
    insert into public.team_managers (team_id, user_id, role, invited_by)
    values (team_uuid, target_user_id, manager_role::team_manager_role, auth.uid())
    returning id into new_id;
  end if;

  delete from public.team_manager_invites
   where team_id = team_uuid and lower(email) = clean_email;

  return json_build_object(
    'id',      new_id,
    'teamId',  team_uuid,
    'userId',  target_user_id,
    'role',    manager_role,
    'email',   target_email,
    'name',    target_name,
    'pending', false
  );
end;
$$;

grant execute on function public.invite_team_manager_by_email(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- List / remove
-- ----------------------------------------------------------------------------
create or replace function public.list_team_managers(team_uuid uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.can_manage_team(team_uuid) then
    raise exception 'Not authorized to view this team';
  end if;

  select coalesce(json_agg(row_to_json(r) order by r.created_at), '[]'::json) into result
  from (
    select tm.id,
           tm.team_id     as "teamId",
           tm.user_id     as "userId",
           tm.role::text  as role,
           p.email,
           p.display_name as name,
           false          as pending,
           tm.created_at
    from public.team_managers tm
    join public.profiles p on p.id = tm.user_id
    where tm.team_id = team_uuid

    union all

    -- Waiting invites are only visible to staff who can delegate the team.
    select i.id,
           i.team_id      as "teamId",
           null::uuid     as "userId",
           i.role::text   as role,
           i.email,
           null::text     as name,
           true           as pending,
           i.created_at
    from public.team_manager_invites i
    where i.team_id = team_uuid
      and public.can_delegate_team(team_uuid)
  ) r;

  return result;
end;
$$;

grant execute on function public.list_team_managers(uuid) to authenticated;

create or replace function public.remove_team_manager(manager_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_managers where id = manager_id;

  if v_team_id is not null then
    if not public.can_delegate_team(v_team_id) then
      raise exception 'Not authorized to change managers on this team';
    end if;
    delete from public.team_managers where id = manager_id;
    return;
  end if;

  select team_id into v_team_id from public.team_manager_invites where id = manager_id;
  if v_team_id is null then
    return; -- already gone; removing twice is not an error
  end if;

  if not public.can_delegate_team(v_team_id) then
    raise exception 'Not authorized to change managers on this team';
  end if;

  delete from public.team_manager_invites where id = manager_id;
end;
$$;

grant execute on function public.remove_team_manager(uuid) to authenticated;
