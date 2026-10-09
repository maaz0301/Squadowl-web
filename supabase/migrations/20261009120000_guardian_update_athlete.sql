-- guardian_update_athlete(athlete_id, patch) — lets a guardian edit their own
-- athlete's profile from the guardian portal.
--
-- A guardian has no write access to athletes (athletes_update is staff-only), so
-- a plain client update silently changes nothing — the bug reported as "unable to
-- edit player in guardian portal". Like guardian_remove_athlete(), this runs as
-- SECURITY DEFINER and authorizes the caller against the athlete the same way
-- get_guardian_rosters() matches "mine": the linked guardian_user_id, or
-- guardian_email when the accounts were never linked up.
--
-- Only the fields a family owns are writable. Anything that decides who may see
-- the athlete (guardian_user_id, guardian_email, account_id) or what the coach
-- manages (jersey, position, scores) is deliberately not accepted, so a guardian
-- cannot re-point the athlete at another account or lock their coach out.
-- A key left out of the patch is left alone; an empty string clears the field.

create or replace function public.guardian_update_athlete(p_athlete_id uuid, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  v_guardian_user_id uuid;
  v_guardian_email citext;
  v_found boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select true, a.guardian_user_id, a.guardian_email
    into v_found, v_guardian_user_id, v_guardian_email
  from public.athletes a
  where a.id = p_athlete_id;

  if not coalesce(v_found, false) then
    raise exception 'Athlete not found' using errcode = 'P0002';
  end if;

  if not (
    v_guardian_user_id = auth.uid()
    or (v_caller_email is not null and v_guardian_email = v_caller_email::citext)
  ) then
    raise exception 'Not authorized to edit this athlete' using errcode = '42501';
  end if;

  if p_patch ? 'first_name' and btrim(coalesce(p_patch ->> 'first_name', '')) = '' then
    raise exception 'First name is required' using errcode = '22023';
  end if;
  if p_patch ? 'last_name' and btrim(coalesce(p_patch ->> 'last_name', '')) = '' then
    raise exception 'Last name is required' using errcode = '22023';
  end if;

  update public.athletes a
     set first_name     = case when p_patch ? 'first_name'    then btrim(p_patch ->> 'first_name')  else a.first_name end,
         last_name      = case when p_patch ? 'last_name'     then btrim(p_patch ->> 'last_name')   else a.last_name end,
         year_of_birth  = case when p_patch ? 'year_of_birth' then nullif(p_patch ->> 'year_of_birth', '')::int else a.year_of_birth end,
         date_of_birth  = case when p_patch ? 'date_of_birth' then nullif(p_patch ->> 'date_of_birth', '')::date else a.date_of_birth end,
         player_email   = case when p_patch ? 'player_email'  then nullif(btrim(p_patch ->> 'player_email'), '') else a.player_email end,
         guardian_name  = case when p_patch ? 'guardian_name' then nullif(btrim(p_patch ->> 'guardian_name'), '') else a.guardian_name end,
         guardian_phone = case when p_patch ? 'guardian_phone' then nullif(btrim(p_patch ->> 'guardian_phone'), '') else a.guardian_phone end,
         medical_info   = case when p_patch ? 'medical_info'  then nullif(btrim(p_patch ->> 'medical_info'), '') else a.medical_info end,
         about          = case when p_patch ? 'about'         then nullif(btrim(p_patch ->> 'about'), '') else a.about end
   where a.id = p_athlete_id;
end;
$$;

revoke all on function public.guardian_update_athlete(uuid, jsonb) from public;
grant execute on function public.guardian_update_athlete(uuid, jsonb) to authenticated;
revoke execute on function public.guardian_update_athlete(uuid, jsonb) from anon;

-- can_edit_athlete_contacts() only honoured guardian_user_id, so a guardian whose
-- login was never linked (matched by email in get_guardian_rosters()) could see
-- their athlete but not add a family member. Same email fallback as above.
create or replace function public.can_edit_athlete_contacts(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      at.guardian_user_id = auth.uid()
      or (
        nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') is not null
        and at.guardian_email = lower(auth.jwt() ->> 'email')::citext
      )
      or public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
    )
  );
$$;
