-- remove_org_member(uuid) — remove a person from the organization.
--
-- Manage Organization used to delete straight from `memberships` /
-- `tryout_assessors`. Under RLS, a DELETE whose rows the policy filters out
-- removes nothing and *still* answers 204 with no error, so the client saw a
-- clean success, invalidated the list, and refetched the same person back. This
-- is the same failure `update_org_member_role` was introduced to fix for the
-- role change — see the comment on updateOrgMemberRole() in
-- SupabaseDataSource.ts. Running the delete inside a SECURITY DEFINER function
-- lets it authorize the caller once and raise a real exception when it removes
-- nothing, instead of reporting a removal that never happened.
--
-- It also fixes a second bug the delete-by-row-id had. listOrgMembers() dedupes
-- by e-mail, so an assessor appears once, under whichever tryout_assessors row
-- was read first — but the same person can hold an assessor row on every
-- assessment the account owns. Deleting that one row left the others in place
-- and the person reappeared on the next refetch. Removal here is by identity
-- (user_id when the account is linked, e-mail otherwise) across every
-- assessment the account owns.
--
-- NOTE FOR REVIEW: the admin check below is reconstructed from the app's
-- usePermissions() — Manage Organization is gated on role === 'admin', with
-- 'owner' folded into 'admin' (authStore.ts) — and from how ctx() resolves an
-- account through `memberships`. It is not copied from the memberships/
-- tryout_assessors policies, which live in the backend repo and are the source
-- of truth. Diff both against them before applying, and widen or narrow to
-- match. In particular, if `accounts` carries its own owner column rather than
-- relying on an 'owner' membership row, add that branch to the check.
--
-- Delegated team access (`team_managers`, CLUB mode) is deliberately NOT
-- touched here. Those rows are created and dropped through the shared backend's
-- invite_team_manager_by_email/remove_team_manager, which carry their own
-- club-owner check, so removeOrgMember() revokes them through
-- remove_team_manager() after this function returns rather than deleting from a
-- table this repo cannot see the policies for. Folding it in is a reasonable
-- future revision — do it in the backend repo, next to that table.
--
-- The check is inlined rather than split into a shared is_org_admin() helper:
-- this repo cannot see the backend's function list, and a `create or replace`
-- on a name already in use there would silently rewrite someone else's
-- function. Until the migration is applied, removeOrgMember() falls back to
-- direct deletes that read the row back afterwards, so a removal RLS refuses
-- raises instead of reporting a success the next refetch undoes.

create or replace function public.remove_org_member(member_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_user_id uuid;
  v_email text;
  v_role text;
  v_removed integer := 0;
begin
  -- 1. Staff who hold a membership on the account.
  select m.account_id, m.role
    into v_account_id, v_role
  from public.memberships m
  where m.id = member_id;

  if v_account_id is not null then
    if not exists (
      select 1 from public.memberships m
      where m.account_id = v_account_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    ) then
      raise exception 'Not authorized to remove members from this organization'
        using errcode = '42501';
    end if;
    -- The screen already hides the action for admins; this is the server-side
    -- half of that, so the last owner can't be removed out from under the org.
    if v_role in ('owner', 'admin') then
      raise exception 'An organization admin cannot be removed here'
        using errcode = '42501';
    end if;

    delete from public.memberships where id = member_id;
    get diagnostics v_removed = row_count;
    if v_removed = 0 then
      raise exception 'Member could not be removed' using errcode = 'P0002';
    end if;
    return;
  end if;

  -- 2. Assessors, who exist only as rows against the account's assessments.
  select ta.user_id, ta.email, t.account_id
    into v_user_id, v_email, v_account_id
  from public.tryout_assessors ta
  join public.tryouts t on t.id = ta.tryout_id
  where ta.id = member_id;

  if v_account_id is not null then
    if not exists (
      select 1 from public.memberships m
      where m.account_id = v_account_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    ) then
      raise exception 'Not authorized to remove members from this organization'
        using errcode = '42501';
    end if;

    -- Every assessor row this person holds under the account, not just the one
    -- whose id the list happened to surface.
    delete from public.tryout_assessors ta
    using public.tryouts t
    where ta.tryout_id = t.id
      and t.account_id = v_account_id
      and (
        (v_user_id is not null and ta.user_id = v_user_id)
        or (v_email is not null and lower(ta.email) = lower(v_email))
      );
    get diagnostics v_removed = row_count;
    if v_removed = 0 then
      raise exception 'Member could not be removed' using errcode = 'P0002';
    end if;
    return;
  end if;

  -- 3. Guardians, who are not members at all — they are the guardian contact on
  -- one or more of the account's athletes, so removal clears that contact.
  select a.account_id, a.guardian_email
    into v_account_id, v_email
  from public.athletes a
  where a.id = member_id;

  if v_account_id is not null and v_email is not null then
    if not exists (
      select 1 from public.memberships m
      where m.account_id = v_account_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    ) then
      raise exception 'Not authorized to remove members from this organization'
        using errcode = '42501';
    end if;

    update public.athletes
       set guardian_name = null,
           guardian_email = null,
           guardian_phone = null,
           guardian_user_id = null
     where account_id = v_account_id
       and lower(guardian_email) = lower(v_email);
    get diagnostics v_removed = row_count;
    if v_removed = 0 then
      raise exception 'Member could not be removed' using errcode = 'P0002';
    end if;
    return;
  end if;

  raise exception 'Member not found' using errcode = 'P0002';
end;
$$;

revoke all on function public.remove_org_member(uuid) from public;
grant execute on function public.remove_org_member(uuid) to authenticated;
