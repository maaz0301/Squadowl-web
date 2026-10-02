-- Full date of birth (year, month and day) for athletes and registrations.
--
-- A coach asked for the option to enter a full date of birth when registering or
-- adding a player, where only the year could be chosen. The year stays: it is what
-- age sorting and every existing screen read, and it is still a complete answer on
-- its own. The date is optional and sits beside it, so nothing that already reads
-- year_of_birth changes.
--
-- Additive only. submit_public_registration (the QR / public form) is the one
-- function that names the registrations columns itself; it is replaced below with
-- the body from 20260831120000_player_email_and_team_invites.sql plus the new
-- column. The authenticated app saves the date with its own follow-up update.

alter table public.athletes add column if not exists date_of_birth date;
alter table public.registrations add column if not exists date_of_birth date;

create or replace function public.submit_public_registration(
  code text,
  payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  fee_cents int;
  charges_enabled boolean;
  inserted_row jsonb;
begin
  select t.id, t.registration_fee_cents, a.stripe_connect_charges_enabled
    into t_id, fee_cents, charges_enabled
    from public.tryouts t
    join public.accounts a on a.id = t.account_id
   where upper(t.registration_code) = upper(code)
     and t.registration_open = true;

  if t_id is null then
    raise exception 'Invalid or closed registration code';
  end if;

  insert into public.registrations (
    tryout_id,
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
    payload->>'firstName',
    payload->>'lastName',
    (payload->>'yearOfBirth')::int,
    -- Only a well-formed YYYY-MM-DD; anything else is stored as no date rather than failing the registration.
    case when payload->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$' then (payload->>'dateOfBirth')::date else null end,
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
