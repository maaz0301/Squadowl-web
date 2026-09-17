-- Founder console: User Management — search every user by name/email/org,
-- change their role in an organization, and log founder-initiated password
-- resets / verification resends. Ban and delete are NOT here: Postgres has no
-- access to auth.users beyond what these SECURITY DEFINER functions already
-- read, so those two go through the founder-user-admin edge function (service
-- role) instead, which logs its own founder_audit_log row directly (service
-- role bypasses RLS, the same way every other privileged write here does).
--
-- Builds on 20260916120000_founder_org_management.sql — same is_founder()
-- gate, same founder_audit_log table and founder_write_audit() helper.

-- ---------------------------------------------------------------------------
-- Audit log: new action kinds
-- ---------------------------------------------------------------------------

alter table public.founder_audit_log
  drop constraint if exists founder_audit_log_action_check;

alter table public.founder_audit_log
  add constraint founder_audit_log_action_check
  check (action in (
    'suspend', 'reactivate', 'create_org', 'update_access',
    'impersonate_start', 'impersonate_end',
    'update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user'
  ));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- One page of users, searched across name, email and organization name.
-- Reads auth.users directly for sign-in/verification/ban state the same way
-- is_founder() does — this function runs as its (trusted) owner, not as the
-- caller, so it can see columns RLS would otherwise hide.
create or replace function public.founder_list_users(
  p_search text default null,
  p_account_id uuid default null,
  p_role text default null,        -- null | 'owner' | 'admin' | 'coach' | 'assessor' | 'guardian'
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id                 uuid,
  email              text,
  display_name       text,
  created_at         timestamptz,
  last_sign_in_at    timestamptz,
  email_confirmed_at timestamptz,
  banned_until       timestamptz,
  memberships        jsonb,
  total_count        bigint
) language plpgsql stable security definer set search_path = public, auth as $$
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
     where (q is null
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
$$;

grant execute on function public.founder_list_users(text, uuid, text, int, int) to authenticated;

-- Change someone's role within one organization. Ownership is left to that
-- organization's own Members page — reassigning the sole owner needs more
-- care (it can't be left without one) than a platform-admin tool should do
-- in a single click.
create or replace function public.founder_set_user_role(
  p_user_id uuid,
  p_account_id uuid,
  p_role text
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_before text;
  v_email text;
  v_account_name text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'coach', 'assessor', 'guardian') then
    raise exception 'Role must be admin, coach, assessor or guardian' using errcode = '22023';
  end if;

  select role::text into v_before
    from public.memberships
   where user_id = p_user_id and account_id = p_account_id;
  if not found then
    raise exception 'This person is not a member of that organization' using errcode = 'P0002';
  end if;
  if v_before = 'owner' then
    raise exception 'Change the owner from the organization''s own Members page' using errcode = '22023';
  end if;
  if v_before = p_role then
    return p_role;
  end if;

  update public.memberships
     set role = p_role::membership_role
   where user_id = p_user_id and account_id = p_account_id;

  select email into v_email from public.profiles where id = p_user_id;
  select name into v_account_name from public.accounts where id = p_account_id;

  perform public.founder_write_audit(
    'update_user_role', p_account_id, v_account_name, null,
    jsonb_build_object('user_id', p_user_id, 'user_email', v_email, 'from', v_before, 'to', p_role));

  return p_role;
end;
$$;

grant execute on function public.founder_set_user_role(uuid, uuid, text) to authenticated;

-- Records a founder-initiated password reset or verification resend. The
-- email itself goes out through the same paths the app already uses
-- (requestPasswordReset / resendVerificationEmail) — this only logs that the
-- founder triggered it, for the audit log.
create or replace function public.founder_log_user_action(
  p_action text,
  p_user_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_action not in ('reset_password', 'resend_verification') then
    raise exception 'Unsupported action' using errcode = '22023';
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  perform public.founder_write_audit(p_action, null, v_email, p_reason, jsonb_build_object('user_id', p_user_id));
end;
$$;

grant execute on function public.founder_log_user_action(text, uuid, text) to authenticated;
