-- A team's own sport, so its player cards, labels and sign-up form match it
-- (a skating team has Skaters, not positions). Optional: a team without one
-- keeps the standard card.
alter table public.teams add column if not exists sport text;

-- What a public sign-up link needs to tailor its form: the name and sport of
-- whatever the code opens. Reads nothing private and says nothing about a code
-- that is closed or unknown.
create or replace function public.registration_link_info(code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  found jsonb;
begin
  select jsonb_build_object('kind', 'evaluation', 'name', t.name, 'sport', t.sport)
    into found
    from public.tryouts t
   where upper(t.registration_code) = upper(code)
     and t.registration_open = true
   limit 1;
  if found is not null then return found; end if;

  select jsonb_build_object('kind', 'team', 'name', te.name, 'sport', te.sport)
    into found
    from public.teams te
   where upper(te.registration_code) = upper(code)
     and te.registration_open = true
     and te.archived = false
   limit 1;
  return found;
end;
$$;

grant execute on function public.registration_link_info(text) to anon, authenticated;
