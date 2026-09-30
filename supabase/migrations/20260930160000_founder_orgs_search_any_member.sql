-- Founder Console: search matches any member's email, and an organization with no owner
-- shows its first non-guardian member (coach/admin) instead of 'No owner'.
CREATE OR REPLACE FUNCTION public.founder_list_organizations(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_include_individual boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, account_type text, plan_tier text, subscription_status text, access_status text, suspended_at timestamp with time zone, suspended_reason text, trial_ends_at timestamp with time zone, is_comp boolean, owner_email text, member_count integer, team_count integer, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select a.*, public.account_access_status(a) as status
      from public.accounts a
     where not a.hidden_from_founder
       and (p_include_individual or a.type = 'organization')
       and (q is null
            or a.name ilike '%' || q || '%'
            or exists (select 1
                         from public.memberships m
                         join public.profiles p on p.id = m.user_id
                        where m.account_id = a.id
                          and p.email ilike '%' || q || '%'))
  ),
  page as (
    select f.*, count(*) over () as total
      from filtered f
     where p_status is null or f.status = p_status
     order by f.created_at desc, f.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id,
         pg.name,
         pg.type::text,
         pg.plan_tier::text,
         pg.subscription_status::text,
         pg.status,
         pg.suspended_at,
         pg.suspended_reason,
         pg.trial_ends_at,
         pg.is_comp,
         o.email::text,
         coalesce(mc.n, 0)::int,
         coalesce(tc.n, 0)::int,
         pg.created_at,
         pg.total
    from page pg
    left join lateral (
      select p.email
        from public.memberships m
        join public.profiles p on p.id = m.user_id
       where m.account_id = pg.id and m.role::text <> 'guardian'
       order by (m.role = 'owner') desc, m.created_at
       limit 1
    ) o on true
    left join lateral (select count(*) as n from public.memberships m where m.account_id = pg.id) mc on true
    left join lateral (select count(*) as n from public.teams t where t.account_id = pg.id and not t.archived) tc on true
   order by pg.created_at desc, pg.id;
end;
$function$;
