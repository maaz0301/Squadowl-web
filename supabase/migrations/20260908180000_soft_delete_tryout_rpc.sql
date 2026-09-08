-- soft_delete_tryout(uuid) — delete an assessment, as the coach who owns it.
--
-- Reported by a client coach: signed in on a second account that was only an
-- *assessor* on someone else's tryout, they could still delete it. The web app
-- hides the Settings tab (and its Danger Zone) from assessors by opening the
-- assessment with `?assessor=1` and filtering the tab strip on that parameter —
-- so removing the parameter from the URL brought the whole tab back, Delete
-- included, and the delete itself went straight at `tryouts` as a plain
-- `update ... set deleted_at`. Nothing server-side said no.
--
-- The web app now decides that from `viewerIsOwner` on the assessment rather
-- than from the URL (see assembleTryouts() in SupabaseDataSource.ts), but a
-- hidden button is not a permission check: PostgREST is reachable directly with
-- the same token. This function is the check that actually holds, and
-- deleteTryout() calls it instead of updating the table.
--
-- Authorized, matching what the app treats as an owner:
--   1. staff on the account the assessment belongs to (owner/admin/coach) —
--      this is the coach who created it, since createTryout() always inserts
--      under the caller's own resolved account;
--   2. its lead assessor (createTryout() seeds the creator's own row as
--      'lead'), which keeps a coach running an assessment on a club's account
--      in charge of it;
--   3. a coach the assessment's *team* reaches — CLUB-mode delegation, or a
--      club owner whose team a delegate created the assessment under. Both are
--      asked through the deployed list_tryouts_for_managed_teams() /
--      list_tryouts_on_my_owned_teams() functions, the same two listTryouts()
--      merges, rather than reading `team_managers` directly: that table's shape
--      and policies live in the backend repo, and this repo has no way to see
--      them (same reasoning as the note on remove_org_member).
--
-- Everyone else — an invited assessor, a helper, a guardian — gets 42501.
--
-- NOTE FOR REVIEW: the membership check is reconstructed from how ctx() and
-- writableAccountId() resolve an account in SupabaseDataSource.ts, not copied
-- from the `tryouts` policies, which live in the backend repo and are the
-- source of truth. Diff it against them before applying. This function narrows
-- who can delete; it does NOT stop a direct `update tryouts set deleted_at`
-- from a client whose RLS policy still allows one. Closing that needs a policy
-- change on `tryouts` in the backend repo — either drop UPDATE for non-owners
-- or add a restrictive policy that only lets an owner set deleted_at. Until
-- then this is the app's path, and deleteTryout() falls back to the old direct
-- update (behind the same check, client-side) only when this function is not
-- deployed.

create or replace function public.soft_delete_tryout(p_tryout_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_deleted_at timestamptz;
  v_allowed boolean := false;
begin
  select t.account_id, t.deleted_at
    into v_account_id, v_deleted_at
  from public.tryouts t
  where t.id = p_tryout_id;

  if v_account_id is null then
    raise exception 'Evaluation not found' using errcode = 'P0002';
  end if;

  -- 1. Staff on the account that owns it.
  select exists (
    select 1 from public.memberships m
    where m.account_id = v_account_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'coach')
  ) into v_allowed;

  -- 2. Its lead assessor.
  if not v_allowed then
    select exists (
      select 1 from public.tryout_assessors a
      where a.tryout_id = p_tryout_id
        and a.user_id = auth.uid()
        and a.role = 'lead'
    ) into v_allowed;
  end if;

  -- 3. A coach who reaches it through the team. Asked dynamically so an
  --    instance that hasn't deployed these functions yet still gets 1 and 2
  --    rather than a function that won't create; any error from them is read as
  --    "not this way", never as a grant.
  if not v_allowed
     and to_regprocedure('public.list_tryouts_for_managed_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_for_managed_teams() t where t.id = $1)'
        into v_allowed using p_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed
     and to_regprocedure('public.list_tryouts_on_my_owned_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_on_my_owned_teams() t where t.id = $1)'
        into v_allowed using p_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed then
    raise exception 'Only the coach who created this evaluation can delete it'
      using errcode = '42501';
  end if;

  -- Already gone: nothing to do, and no error — the caller's intent holds.
  if v_deleted_at is not null then
    return;
  end if;

  -- Soft delete, exactly as deleteTryout() did: the row and everything it
  -- cascades to stay for the athletes' permanent history, and every
  -- coach-facing read filters on deleted_at.
  update public.tryouts
     set deleted_at = now()
   where id = p_tryout_id;
end;
$$;

revoke all on function public.soft_delete_tryout(uuid) from public;
grant execute on function public.soft_delete_tryout(uuid) to authenticated;
