-- find_coach_by_email(): looks up coach/admin/owner accounts by the coach's
-- own email, so a guardian can share an athlete's profile by typing the
-- coach's email address instead of browsing list_coach_directory()'s full
-- result — every coach/admin/owner across every account on the platform,
-- which is a long, irrelevant (and slightly alarming) list to hand a
-- guardian who just wants to reach one specific coach. Mirrors
-- invite_org_member_by_email()'s email lookup (0007_invite_org_member_rpc.sql).
--
-- Returns every (user, account) match for that email with a coach-capable
-- role, same shape as list_coach_directory() — almost always zero or one row,
-- but a coach can hold that role on more than one account.
create or replace function public.find_coach_by_email(p_email text)
returns table (
  user_id uuid, display_name text, avatar_url text,
  account_id uuid, account_name text, sport text
) language sql stable security definer set search_path = public as $$
  select distinct on (p.id, a.id) p.id, p.display_name, p.avatar_url, a.id, a.name, a.sport
  from public.profiles p
  join public.memberships m on m.user_id = p.id
  join public.accounts a on a.id = m.account_id
  where p.email = trim(p_email)
    and m.role in ('owner','admin','coach')
  order by p.id, a.id;
$$;
grant execute on function public.find_coach_by_email(text) to authenticated;
