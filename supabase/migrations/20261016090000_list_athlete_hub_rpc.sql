-- Athlete Hub list and search.
--
-- The hub used to read the athletes table through row level security in 200 row
-- chunks and match names in the app, up to 4000 rows per search. That is many
-- round trips, each paying the per row policy cost. This function checks the
-- caller's role on the account once and answers in a single query: one page of
-- athletes (plus one extra row so the app knows there is a next page),
-- optionally filtered by name, guardian or email (partial words, any order). Staff only.

create or replace function public.list_athlete_hub(
  p_account_id uuid,
  p_term text default '',
  p_offset integer default 0,
  p_limit integer default 60
)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text;
  v_words text[];
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- LIKE wildcards in what was typed are dropped, not honoured.
  v_term := btrim(regexp_replace(coalesce(p_term, ''), '[%_\\]', '', 'g'));
  -- Every word typed must appear somewhere in the name, guardian or email, in any
  -- order and anywhere in the word, so "ar", "mith jo" and "smith john" all find John Smith.
  v_words := array(select w from unnest(regexp_split_to_array(v_term, '\s+')) w where w <> '' limit 5);

  return query
  select to_jsonb(a)
  from (
    select x.id, x.first_name, x.last_name, x.year_of_birth, x.avatar_url, x.default_position,
           x.guardian_name, x.guardian_email, x.player_email
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
          or coalesce(x.guardian_name, '') ilike '%' || w || '%'
          or coalesce(x.guardian_email, '') ilike '%' || w || '%'
          or coalesce(x.player_email, '') ilike '%' || w || '%'
        )
      )
    order by x.first_name, x.last_name, x.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit v_limit + 1
  ) a;
end;
$$;
grant execute on function public.list_athlete_hub(uuid, text, integer, integer) to authenticated;
revoke execute on function public.list_athlete_hub(uuid, text, integer, integer) from anon, public;
