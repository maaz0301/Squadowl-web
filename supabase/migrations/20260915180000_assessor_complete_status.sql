-- "Complete Assessing": an invited assessor ends their session from the
-- scoring screen, and the evaluation leaves their "Assigned to me" hub.
--
-- Only the assessor's own invite row changes. The evaluation, its roster and
-- every score stay exactly where they are for the owner / coach / team
-- manager. Every access check that admits an assessor tests
-- `status <> 'declined'`, so a completed assessor keeps read access to what
-- they scored — the hub simply stops listing it (fetchAssignedTryoutRows).

-- The status check was declined inline (20260812190000), so its name is the
-- generated one; look it up rather than assuming it.
do $$
declare
  c text;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.tryout_assessors'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.tryout_assessors drop constraint %I', c);
  end loop;
end $$;

alter table public.tryout_assessors
  add constraint tryout_assessors_status_check
  check (status in ('pending', 'accepted', 'declined', 'completed'));

create or replace function public.set_assessor_status(p_tryout_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('accepted', 'declined', 'completed') then
    raise exception 'Invalid assessor status: %', p_status;
  end if;

  -- The lead is the evaluation's owner; completing would hide it from the
  -- person it belongs to. Only invited assessors end a session this way.
  -- By e-mail too: an assessor added from Settings can hold a row that was
  -- never linked to their user id.
  if p_status = 'completed' then
    update public.tryout_assessors
       set status = p_status
     where tryout_id = p_tryout_id
       and (user_id = auth.uid() or (user_id is null and email = auth.email()))
       and role <> 'lead';
  else
    update public.tryout_assessors
       set status = p_status
     where tryout_id = p_tryout_id
       and user_id = auth.uid();
  end if;

  if not found then
    raise exception 'No assessor invite found for this user on this tryout';
  end if;
end;
$$;

grant execute on function public.set_assessor_status(uuid, text) to authenticated;
