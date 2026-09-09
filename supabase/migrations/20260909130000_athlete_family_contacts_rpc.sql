-- add_athlete_family_contact / remove_athlete_family_contact — manage a
-- player's extra family contacts, as an assessor.
--
-- Reported by a client coach: an assessor adding a family member from Edit
-- Player got "new row violates row-level security policy for table
-- \"athlete_family_contacts\"" — a real, surfaced error this time (an INSERT
-- policy's WITH CHECK failing is a genuine Postgres error, unlike an UPDATE or
-- DELETE it rejects, which silently matches zero rows instead — see the note
-- on updatePlayer() for that shape). The `athlete_family_contacts` policies
-- only admit staff on the account that owns the athlete, the same gap
-- update_tryout_player() closed for the player's own fields, for the same
-- reason: an assessor reaches an evaluation through a tryout_assessors row,
-- not a membership.
--
-- Authorized, matching update_tryout_player():
--   1. staff on the account the athlete belongs to (owner/admin/coach);
--   2. an assessor invited (any role, not declined) to a tryout this athlete
--      is a participant on — deliberately scoped through tryout_participants
--      rather than granted for any athlete anywhere, so being invited to score
--      one evaluation doesn't hand out write access to every athlete in the
--      account.
--
-- Deliberately NOT included: a delegated team coach (CLUB-mode), the third
-- tier soft_delete_tryout() and update_tryout_player() both check. That check
-- goes through list_tryouts_for_managed_teams(), which answers "which tryouts
-- does this team reach", and a team-roster player added by hand may have no
-- tryout at all to ask it about. Add a parallel team_roster-based check here if
-- a delegate hits the same wall — this migration only closes the path that was
-- actually reported.
--
-- NOTE FOR REVIEW: the membership and assessor checks are reconstructed from
-- update_tryout_player() in this repo, not copied from the
-- `athlete_family_contacts` / `athletes` policies, which live in the backend
-- repo and are the source of truth. Diff before applying, and confirm
-- `athletes.account_id` and the `athlete_family_contacts` column list below
-- still match. Client fallback only: a coach's add/remove still goes through
-- the direct table call first (see SupabaseDataSource.ts), so this widens who
-- can write without changing anything about the tables' own policies.

create or replace function public.athlete_is_reachable(p_athlete_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed boolean := false;
begin
  select exists (
    select 1
    from public.athletes a
    join public.memberships m on m.account_id = a.account_id
    where a.id = p_athlete_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'coach')
  ) into v_allowed;

  if not v_allowed then
    select exists (
      select 1
      from public.tryout_participants tp
      join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
      where tp.athlete_id = p_athlete_id
        and ta.user_id = auth.uid()
        and coalesce(ta.status, 'accepted') <> 'declined'
    ) into v_allowed;
  end if;

  return v_allowed;
end;
$$;

revoke all on function public.athlete_is_reachable(uuid) from public;
grant execute on function public.athlete_is_reachable(uuid) to authenticated;

create or replace function public.add_athlete_family_contact(
  p_athlete_id uuid,
  p_name text,
  p_relationship text default null,
  p_email text default null,
  p_phone text default null
)
returns public.athlete_family_contacts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.athlete_family_contacts;
begin
  if not public.athlete_is_reachable(p_athlete_id) then
    raise exception 'You do not have permission to edit this player''s family contacts'
      using errcode = '42501';
  end if;

  insert into public.athlete_family_contacts (athlete_id, name, relationship, email, phone, created_by)
  values (p_athlete_id, p_name, nullif(p_relationship, ''), nullif(p_email, ''), nullif(p_phone, ''), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_athlete_family_contact(uuid, text, text, text, text) from public;
grant execute on function public.add_athlete_family_contact(uuid, text, text, text, text) to authenticated;

create or replace function public.remove_athlete_family_contact(p_contact_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
begin
  select athlete_id into v_athlete_id
  from public.athlete_family_contacts
  where id = p_contact_id;

  -- Already gone: nothing to do, and no error — matches soft_delete_tryout()'s
  -- reasoning, and a second click on a Remove button that already succeeded
  -- shouldn't read as a permission failure.
  if v_athlete_id is null then
    return;
  end if;

  if not public.athlete_is_reachable(v_athlete_id) then
    raise exception 'You do not have permission to edit this player''s family contacts'
      using errcode = '42501';
  end if;

  delete from public.athlete_family_contacts where id = p_contact_id;
end;
$$;

revoke all on function public.remove_athlete_family_contact(uuid) from public;
grant execute on function public.remove_athlete_family_contact(uuid) to authenticated;
