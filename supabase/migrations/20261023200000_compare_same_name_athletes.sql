-- Compare: the other records of the same child, found by name, fast on a very large account.
--
-- Adding a player to several evaluations files a new athlete record each time, so one
-- child is often several records. Compare shows them as one row and needs the evaluations
-- of every record. Finding them with a case-insensitive name filter from the client
-- timed out on an account with 150,000+ players, so the match is done here, against an
-- index on the lower-cased name (either order), for the athletes of one account.

create index if not exists idx_athletes_account_name
  on public.athletes (account_id, lower(last_name), lower(first_name));

create or replace function public.list_same_name_athletes(p_account_id uuid, p_athlete_ids uuid[])
returns table (id uuid, first_name text, last_name text, year_of_birth integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with sel as (
    select distinct lower(s.first_name) as f, lower(s.last_name) as l
    from public.athletes s
    where s.id = any (p_athlete_ids[1:100])
      and coalesce(s.first_name, '') <> '' and coalesce(s.last_name, '') <> ''
  )
  select a.id, a.first_name, a.last_name, a.year_of_birth::integer
  from sel
  join public.athletes a
    on a.account_id = p_account_id and lower(a.last_name) = sel.l and lower(a.first_name) = sel.f
  where not a.archived
  union
  -- The same name written the other way round.
  select a.id, a.first_name, a.last_name, a.year_of_birth::integer
  from sel
  join public.athletes a
    on a.account_id = p_account_id and lower(a.last_name) = sel.f and lower(a.first_name) = sel.l
  where not a.archived;
end;
$$;
grant execute on function public.list_same_name_athletes(uuid, uuid[]) to authenticated;
revoke execute on function public.list_same_name_athletes(uuid, uuid[]) from anon, public;
