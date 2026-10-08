-- Registration links for teams.
--
-- An evaluation has a public registration link and QR code that families use to
-- register a player. A coach asked for the same when a team is created, so a team
-- now carries its own code, and a registration can belong to a team instead of an
-- evaluation.
--
-- Additive. Nothing that reads registrations by tryout_id changes: team
-- registrations simply have no tryout_id. submit_public_registration (the public
-- form) is replaced below with the 20261002140000_date_of_birth.sql body plus a
-- team lookup that runs only when no evaluation has the code, so every existing
-- evaluation link keeps working exactly as before.

alter table public.teams add column if not exists registration_code text;
alter table public.teams add column if not exists registration_open boolean not null default false;
create unique index if not exists idx_teams_registration_code
  on public.teams (upper(registration_code)) where registration_code is not null;

alter table public.registrations alter column tryout_id drop not null;
alter table public.registrations add column if not exists team_id uuid
  references public.teams(id) on delete cascade;
alter table public.registrations drop constraint if exists registrations_one_target;
alter table public.registrations add constraint registrations_one_target
  check (num_nonnulls(tryout_id, team_id) = 1);
create index if not exists idx_registrations_team on public.registrations(team_id)
  where team_id is not null;

-- Staff of the owning account (or a delegated manager) manage team registrations,
-- exactly as can_manage_tryout does for evaluation ones. Guardian PII: no assessors.
drop policy if exists registrations_rw on public.registrations;
create policy registrations_rw on public.registrations
  for all using (
    case when tryout_id is not null
      then public.can_manage_tryout(tryout_id)
      else public.can_manage_team(team_id)
    end
  )
  with check (
    case when tryout_id is not null
      then public.can_manage_tryout(tryout_id)
      else public.can_manage_team(team_id)
    end
  );

-- Creates the team's code the first time it is asked for and returns it. The code
-- is drawn so it never matches an evaluation's code or another team's, because the
-- public form resolves a code against both.
create or replace function public.ensure_team_registration_code(t uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  existing text;
  candidate text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if not public.can_manage_team(t) then
    raise exception 'Not allowed to manage this team';
  end if;

  select registration_code into existing from public.teams where id = t;
  if existing is not null then
    update public.teams set registration_open = true where id = t and registration_open = false;
    return existing;
  end if;

  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.tryouts where upper(registration_code) = candidate)
          and not exists (select 1 from public.teams where upper(registration_code) = candidate);
  end loop;

  update public.teams set registration_code = candidate, registration_open = true where id = t;
  return candidate;
end;
$$;

-- Opens or closes the team's link without discarding the code, so a QR code that
-- is already printed or sent keeps working when the coach turns it back on.
create or replace function public.set_team_registration_open(t uuid, is_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_team(t) then
    raise exception 'Not allowed to manage this team';
  end if;
  update public.teams set registration_open = is_open where id = t;
end;
$$;

grant execute on function public.ensure_team_registration_code(uuid) to authenticated;
grant execute on function public.set_team_registration_open(uuid, boolean) to authenticated;
revoke execute on function public.ensure_team_registration_code(uuid) from anon, public;
revoke execute on function public.set_team_registration_open(uuid, boolean) from anon, public;

create or replace function public.submit_public_registration(
  code text,
  payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  team_target uuid;
  fee_cents int;
  charges_enabled boolean;
  inserted_row jsonb;
  dob date;
begin
  select t.id, t.registration_fee_cents, a.stripe_connect_charges_enabled
    into t_id, fee_cents, charges_enabled
    from public.tryouts t
    join public.accounts a on a.id = t.account_id
   where upper(t.registration_code) = upper(code)
     and t.registration_open = true;

  -- No evaluation has this code: it may be a team's.
  if t_id is null then
    select te.id into team_target
      from public.teams te
     where upper(te.registration_code) = upper(code)
       and te.registration_open = true
       and te.archived = false;
    fee_cents := null;
    charges_enabled := false;
  end if;

  if t_id is null and team_target is null then
    raise exception 'Invalid or closed registration code';
  end if;

  -- Only a well-formed YYYY-MM-DD; anything else is stored as no date rather than failing the registration.
  dob := case when payload->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$' then (payload->>'dateOfBirth')::date else null end;

  insert into public.registrations (
    tryout_id,
    team_id,
    first_name,
    last_name,
    year_of_birth,
    date_of_birth,
    position_trying_out_for,
    player_email,
    guardian_name,
    guardian_email,
    guardian_phone,
    current_team,
    current_level,
    about_player,
    medical_info,
    friend1_name,
    friend2_name,
    status
  ) values (
    t_id,
    team_target,
    payload->>'firstName',
    payload->>'lastName',
    (payload->>'yearOfBirth')::int,
    dob,
    payload->>'positionTryingOutFor',
    nullif(payload->>'playerEmail', ''),
    payload->>'guardianName',
    payload->>'guardianEmail',
    payload->>'guardianPhone',
    payload->>'currentTeam',
    payload->>'currentLevel',
    payload->>'aboutPlayer',
    payload->>'medicalInfo',
    payload->>'friend1Name',
    payload->>'friend2Name',
    'pending'
  ) returning to_jsonb(public.registrations.*) into inserted_row;

  return inserted_row || jsonb_build_object(
    'registrationFeeCents', fee_cents,
    'connectChargesEnabled', coalesce(charges_enabled, false)
  );
end;
$$;
