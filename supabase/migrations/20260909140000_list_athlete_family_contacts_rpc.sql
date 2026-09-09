-- list_athlete_family_contacts(uuid) — read a player's extra family
-- contacts, as an assessor.
--
-- Reported by a client coach: an assessor's Edit Player showed "No additional
-- contacts added yet." for a player who had two. add_athlete_family_contact()
-- and remove_athlete_family_contact() (see the previous migration) closed the
-- write side of this same gap, but the read was still a bare
-- `select ... from athlete_family_contacts`, which RLS handles by *filtering
-- rows* rather than erroring. A write that's refused is loud — a zero-row
-- UPDATE/DELETE or a rejected INSERT can be told apart from success and
-- retried down an authorized path (see wroteRow() and the '42501' handling in
-- SupabaseDataSource.ts). A refused SELECT is silent: an assessor's read of
-- someone else's-only-visible rows comes back as an empty array, which is
-- bit-for-bit the same response as "this player genuinely has none" — there
-- is no signal here to fall back on, so the client has to ask an authorized
-- path unconditionally rather than detect-and-retry.
--
-- Authorized exactly like the two write functions, through the same
-- athlete_is_reachable() helper: staff on the athlete's account, or an
-- assessor invited (not declined) to a tryout this athlete participates in.
-- Unauthorized simply returns no rows rather than raising — a read has no
-- side effect a caller needs to be warned away from, and every current caller
-- already treats an empty list as "nothing to show."
--
-- NOTE FOR REVIEW: depends on athlete_is_reachable() from
-- 20260909130000_athlete_family_contacts_rpc.sql; apply that one first. Same
-- caveat as there — reconstructed from this repo, not copied from the
-- `athlete_family_contacts` policies, which live in the backend repo.

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
    and public.athlete_is_reachable(p_athlete_id)
  order by c.created_at asc;
$$;

revoke all on function public.list_athlete_family_contacts(uuid) from public;
grant execute on function public.list_athlete_family_contacts(uuid) to authenticated;
