-- Users page: hide a login only when every one of its memberships is a hidden account,
-- so someone who also belongs to a visible organization still shows.
CREATE OR REPLACE FUNCTION public.founder_list_users(p_search text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, email text, display_name text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, email_confirmed_at timestamp with time zone, banned_until timestamp with time zone, memberships jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with base as (
    select p.id, p.email, p.display_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until
      from public.profiles p
      join auth.users u on u.id = p.id
     where not (
             exists (select 1 from public.memberships hm join public.accounts ha on ha.id = hm.account_id
                      where hm.user_id = p.id and ha.hidden_from_founder)
             and not exists (select 1 from public.memberships vm join public.accounts va on va.id = vm.account_id
                              where vm.user_id = p.id and not va.hidden_from_founder))
       and (q is null
            or p.email ilike '%' || q || '%'
            or p.display_name ilike '%' || q || '%'
            or exists (select 1
                         from public.memberships m
                         join public.accounts a on a.id = m.account_id
                        where m.user_id = p.id and a.name ilike '%' || q || '%'))
       and (p_account_id is null or exists (
             select 1 from public.memberships m where m.user_id = p.id and m.account_id = p_account_id))
       and (p_role is null or exists (
             select 1 from public.memberships m where m.user_id = p.id and m.role::text = p_role))
  ),
  page as (
    select b.*, count(*) over () as total
      from base b
     order by b.created_at desc, b.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id,
         pg.email::text,
         pg.display_name,
         pg.created_at,
         pg.last_sign_in_at,
         pg.email_confirmed_at,
         pg.banned_until,
         coalesce(mj.memberships, '[]'::jsonb),
         pg.total
    from page pg
    left join lateral (
      select jsonb_agg(
               jsonb_build_object('accountId', m.account_id, 'accountName', a.name, 'role', m.role)
               order by a.name
             ) as memberships
        from public.memberships m
        join public.accounts a on a.id = m.account_id
       where m.user_id = pg.id
    ) mj on true
   order by pg.created_at desc, pg.id;
end;
$function$;
