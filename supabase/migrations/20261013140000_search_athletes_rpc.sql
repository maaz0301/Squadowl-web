-- Name search for pickers (the Library "Tag a player" field).
--
-- Reading athletes through row level security checks every candidate row, which
-- on an account with tens of thousands of athletes ran past the 8 second request
-- limit. This function checks the caller's role on the account once, then
-- searches that account's athletes directly and returns only a few rows.
-- Staff only (owner, admin, coach), the same people who can manage the Library.

create or replace function public.search_athletes(p_account_id uuid, p_term text, p_limit integer default 8)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_words text[];
  v_one text;
  v_two text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- LIKE wildcards in what was typed are dropped, not honoured.
  v_words := regexp_split_to_array(btrim(regexp_replace(coalesce(p_term, ''), '[%_\\]', '', 'g')), '\s+');
  v_one := v_words[1];
  v_two := v_words[2];
  if v_one is null or v_one = '' then
    return;
  end if;

  return query
  select to_jsonb(a) || jsonb_build_object(
    'tryout_participants',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'current_team', tp.current_team, 'current_level', tp.current_level,
        'jersey', tp.jersey, 'created_at', tp.created_at))
      from public.tryout_participants tp where tp.athlete_id = a.id
    ), '[]'::jsonb))
  from public.athletes a
  where (
      a.account_id = p_account_id
      or exists (select 1 from public.athlete_account_access g where g.athlete_id = a.id and g.account_id = p_account_id)
    )
    and (
      case when v_two is not null and v_two <> ''
        then a.first_name ilike v_one || '%' and a.last_name ilike v_two || '%'
        else a.first_name ilike v_one || '%' or a.last_name ilike v_one || '%'
      end
    )
  order by a.first_name, a.last_name
  limit least(greatest(coalesce(p_limit, 8), 1), 25);
end;
$$;
grant execute on function public.search_athletes(uuid, text, integer) to authenticated;
revoke execute on function public.search_athletes(uuid, text, integer) from anon, public;
