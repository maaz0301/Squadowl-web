-- Compare: rank any players on the account side by side, across teams and seasons.
--
-- 1. saved_comparisons: a coach's named comparison (which players, which evaluation
--    each is read from, how it was filtered and sorted), reopened later from the
--    Compare screen. Account-scoped like the Rubrics Library: staff (owner, admin,
--    coach) of the account can read and change it, nobody else.
-- 2. list_compare_candidates: one page of players for the Compare picker, filtered by
--    name (partial words, any order), team (up to 15), a single birth year or a
--    birth date range. Like list_athlete_hub it checks the caller's role once
--    instead of on every row, which is what keeps it quick on very large accounts.

create table if not exists public.saved_comparisons (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  -- The players compared, at most 100.
  athlete_ids uuid[] not null default '{}' check (cardinality(athlete_ids) <= 100),
  -- Player id -> tryout id, where the coach read a player from an older evaluation.
  choices     jsonb not null default '{}'::jsonb,
  filters     jsonb not null default '{}'::jsonb,
  sort        jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_saved_comparisons_account on public.saved_comparisons(account_id, updated_at desc);

drop trigger if exists set_saved_comparisons_updated_at on public.saved_comparisons;
create trigger set_saved_comparisons_updated_at
  before update on public.saved_comparisons
  for each row execute function public.set_updated_at();

alter table public.saved_comparisons enable row level security;

drop policy if exists saved_comparisons_read on public.saved_comparisons;
create policy saved_comparisons_read on public.saved_comparisons
  for select using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

drop policy if exists saved_comparisons_write on public.saved_comparisons;
create policy saved_comparisons_write on public.saved_comparisons
  for all using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

create or replace function public.list_compare_candidates(
  p_account_id uuid,
  p_term text default '',
  p_team_ids uuid[] default null,
  p_year integer default null,
  p_dob_from date default null,
  p_dob_to date default null,
  p_offset integer default 0,
  p_limit integer default 60
)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text;
  v_words text[];
  v_teams uuid[];
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  v_term := btrim(regexp_replace(coalesce(p_term, ''), '[%_\\]', '', 'g'));
  v_words := array(select w from unnest(regexp_split_to_array(v_term, '\s+')) w where w <> '' limit 5);
  -- At most 15 teams are compared at once.
  v_teams := case when p_team_ids is null or cardinality(p_team_ids) = 0 then null else p_team_ids[1:15] end;

  return query
  select to_jsonb(a)
  from (
    select x.id, x.first_name, x.last_name, x.year_of_birth, x.date_of_birth, x.avatar_url,
           coalesce((
             select jsonb_agg(jsonb_build_object('team_id', t.id, 'team_name', t.name) order by t.name)
             from public.team_roster r
             join public.teams t on t.id = r.team_id
             where r.athlete_id = x.id
           ), '[]'::jsonb) as teams
    from public.athletes x
    where (
        x.account_id = p_account_id
        or exists (select 1 from public.athlete_account_access g where g.athlete_id = x.id and g.account_id = p_account_id)
      )
      and not exists (
        select 1 from unnest(v_words) w
        where not (
          coalesce(x.first_name, '') ilike '%' || w || '%'
          or coalesce(x.last_name, '') ilike '%' || w || '%'
        )
      )
      and (v_teams is null or exists (
        select 1 from public.team_roster r where r.athlete_id = x.id and r.team_id = any(v_teams)
      ))
      and (p_year is null or coalesce(extract(year from x.date_of_birth)::int, x.year_of_birth::int) = p_year)
      and (
        (p_dob_from is null and p_dob_to is null)
        or (
          x.date_of_birth is not null
          and (p_dob_from is null or x.date_of_birth >= p_dob_from)
          and (p_dob_to is null or x.date_of_birth <= p_dob_to)
        )
        or (
          -- Only a birth year is known: keep the player when that year falls in the range.
          x.date_of_birth is null and x.year_of_birth is not null
          and (p_dob_from is null or x.year_of_birth::int >= extract(year from p_dob_from)::int)
          and (p_dob_to is null or x.year_of_birth::int <= extract(year from p_dob_to)::int)
        )
      )
    order by x.first_name, x.last_name, x.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit v_limit + 1
  ) a;
end;
$$;
grant execute on function public.list_compare_candidates(uuid, text, uuid[], integer, date, date, integer, integer) to authenticated;
revoke execute on function public.list_compare_candidates(uuid, text, uuid[], integer, date, date, integer, integer) from anon, public;

-- The birth years that actually occur among the account's players, newest first,
-- for the Compare year dropdown.
create or replace function public.list_compare_birth_years(p_account_id uuid)
returns table (birth_year integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select distinct coalesce(extract(year from x.date_of_birth)::int, x.year_of_birth::int) as y
  from public.athletes x
  where (
      x.account_id = p_account_id
      or exists (select 1 from public.athlete_account_access g where g.athlete_id = x.id and g.account_id = p_account_id)
    )
    and coalesce(extract(year from x.date_of_birth)::int, x.year_of_birth::int) is not null
  order by y desc;
end;
$$;
grant execute on function public.list_compare_birth_years(uuid) to authenticated;
revoke execute on function public.list_compare_birth_years(uuid) from anon, public;
