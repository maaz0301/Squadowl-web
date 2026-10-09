-- A guardian could add a family member to their own athlete but never see it:
-- the list function only admitted staff, assessors and team managers. Admit
-- whoever may already add one (the athlete's guardian, matched by user or email).
create or replace function public.list_athlete_family_contacts(p_athlete_id uuid)
returns setof public.athlete_family_contacts
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.athlete_family_contacts c
  where c.athlete_id = p_athlete_id
    and (public.athlete_is_reachable(p_athlete_id) or public.can_edit_athlete_contacts(p_athlete_id))
  order by c.created_at asc;
$$;
