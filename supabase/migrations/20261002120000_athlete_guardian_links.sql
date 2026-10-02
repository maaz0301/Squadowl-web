-- Several family members connected to one athlete.
--
-- Feedback from a coach: a family contact added to a player is never connected
-- to the guardian portal, and the Invite button can only help the first one.
-- An athlete carries a single guardian (athletes.guardian_user_id / guardian_email),
-- and every access check keys on it, so a second parent or a grandparent could
-- be emailed a login but never see the athlete.
--
-- This adds athlete_guardian_links: one row per extra person connected to an
-- athlete. It is purely additive. The primary guardian (athletes.guardian_user_id,
-- or the guardian_email match) is untouched and still decides everything it did
-- before; each check below only gains an `or is_extra_guardian(athlete)` beside
-- the existing guardian branch (as a separate index-driven EXISTS where rows are scanned), inside the same suspended-account gate it had.
--
-- Bodies are copied from their latest definitions (20260916120000_founder_org_management,
-- 20260915160000, 20260821000100, 20260818150000) with that one-term change, so a
-- diff against those files shows exactly what widened.
--
-- Deliberately left alone: guardian_leave_season / guardian_leave_team_roster.
-- They remove the athlete from the team for everyone, which only the primary
-- guardian may do. An extra guardian leaving is guardian_remove_athlete below,
-- which drops only their own link. athlete_shares stay primary-guardian only.
-- When the primary guardian removes a player, their family contacts are deleted
-- with it (and the links to connected family members, which cascade).
--
-- NOT APPLIED. Review, then apply with the rest of the migrations.

create table if not exists public.athlete_guardian_links (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- The family contact this person was connected from; removing the contact
  -- removes their access with it.
  contact_id  uuid references public.athlete_family_contacts(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (athlete_id, user_id)
);

create index if not exists idx_athlete_guardian_links_user on public.athlete_guardian_links(user_id);
create index if not exists idx_athlete_guardian_links_contact on public.athlete_guardian_links(contact_id);

alter table public.athlete_guardian_links enable row level security;

-- Read-only from the client: a person sees their own links, staff who can edit
-- the athlete's contacts see that athlete's. All writes go through the RPCs below.
drop policy if exists athlete_guardian_links_read on public.athlete_guardian_links;
create policy athlete_guardian_links_read on public.athlete_guardian_links
  for select using (user_id = auth.uid() or public.can_edit_athlete_contacts(athlete_id));

-- True when the signed-in user is a connected extra guardian of the athlete.
-- auth.uid() is null for an anonymous caller, so the comparison is never true.
create or replace function public.is_extra_guardian(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athlete_guardian_links l
    where l.athlete_id = a and l.user_id = auth.uid()
  );
$$;
revoke all on function public.is_extra_guardian(uuid) from public;
revoke execute on function public.is_extra_guardian(uuid) from anon;
grant execute on function public.is_extra_guardian(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Access checks: existing guardian branch OR a connected extra guardian
-- ---------------------------------------------------------------------------
create or replace function public.is_team_guardian(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (exists (
    select 1
    from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    join public.athletes at on at.id = sr.athlete_id
    where se.team_id = t
      and at.guardian_user_id = auth.uid()
  ) or exists (
    select 1
    from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    join public.athlete_guardian_links l on l.athlete_id = sr.athlete_id
    where se.team_id = t
      and l.user_id = auth.uid()
  ))
  and exists (
    select 1 from public.teams te
    where te.id = t and public.account_access_status(te.account_id) <> 'suspended'
  );
$$;

create or replace function public.can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
      or ((at.guardian_user_id = auth.uid() or public.is_extra_guardian(at.id)) and public.account_access_status(at.account_id) <> 'suspended')
    )
  )
  or exists (
    select 1 from public.tryout_participants tp
    join public.tryout_assessors ta on ta.tryout_id = tp.tryout_id
    join public.tryouts ty on ty.id = tp.tryout_id
    where tp.athlete_id = a and ta.user_id = auth.uid()
      and public.account_access_status(ty.account_id) <> 'suspended'
  )
  or public.has_athlete_account_access(a)
  or exists (
    select 1 from public.team_roster tr
    where tr.athlete_id = a and public.is_team_manager(tr.team_id)
  )
  or exists (
    select 1 from public.season_roster sr
    join public.seasons se on se.id = sr.season_id
    where sr.athlete_id = a
      and se.team_id is not null
      and public.is_team_manager(se.team_id)
  );
$$;

create or replace function public.can_access_season(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seasons se where se.id = s and (
      public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
      or (se.team_id is not null and public.is_team_manager(se.team_id))
      or exists (
        select 1 from public.season_roster sr
        join public.athletes at on at.id = sr.athlete_id
        where sr.season_id = s and at.guardian_user_id = auth.uid()
          and public.account_access_status(se.account_id) <> 'suspended'
      )
      or exists (
        select 1 from public.season_roster sr
        join public.athlete_guardian_links l on l.athlete_id = sr.athlete_id
        where sr.season_id = s and l.user_id = auth.uid()
          and public.account_access_status(se.account_id) <> 'suspended'
      )
    )
  );
$$;

create or replace function public.can_access_tryout(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tryouts ty where ty.id = t and (
      public.has_account_role(ty.account_id, array['owner','admin','coach']::membership_role[])
      or (
        exists (select 1 from public.tryout_assessors ta
                where ta.tryout_id = t and ta.user_id = auth.uid())
        and public.account_access_status(ty.account_id) <> 'suspended'
      )
      or (
        exists (select 1 from public.tryout_participants tp
                join public.athletes a on a.id = tp.athlete_id
                where tp.tryout_id = t and a.guardian_user_id = auth.uid())
        and public.account_access_status(ty.account_id) <> 'suspended'
      )
      or (
        exists (select 1 from public.tryout_participants tp
                join public.athlete_guardian_links l on l.athlete_id = tp.athlete_id
                where tp.tryout_id = t and l.user_id = auth.uid())
        and public.account_access_status(ty.account_id) <> 'suspended'
      )
      or (ty.team_id is not null and public.is_team_manager(ty.team_id))
      or (ty.team_id is not null and exists (
            select 1 from public.teams te where te.id = ty.team_id
              and public.has_account_role(te.account_id, array['owner','admin','coach']::membership_role[])
          ))
    )
  );
$$;

create or replace function public.can_edit_athlete_contacts(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes at where at.id = a and (
      ((at.guardian_user_id = auth.uid() or public.is_extra_guardian(at.id)) and public.account_access_status(at.account_id) <> 'suspended')
      or public.has_account_role(at.account_id, array['owner','admin','coach']::membership_role[])
    )
  );
$$;

drop policy if exists availability_write on public.event_availability;
create policy availability_write on public.event_availability
  for all using (
    exists (select 1 from public.season_roster sr join public.athletes at on at.id = sr.athlete_id
            where sr.id = roster_id and (at.guardian_user_id = auth.uid() or public.is_extra_guardian(at.id)))
    or exists (select 1 from public.season_events ev join public.seasons se on se.id = ev.season_id
               where ev.id = season_event_id
               and (
                 public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
                 or (se.team_id is not null and public.is_team_manager(se.team_id))
               ))
  )
  with check (true);

create or replace function public.get_event_availability(p_event_ids uuid[])
returns setof public.event_availability
language sql
stable
security definer
set search_path = public
as $$
  select ea.*
  from public.event_availability ea
  where ea.season_event_id = any(p_event_ids)
    and exists (
      select 1
      from public.season_events se
      join public.seasons s on s.id = se.season_id
      where se.id = ea.season_event_id
        and (
          -- Staff on the account that owns the season.
          has_account_access(s.account_id)
          -- A guardian of any athlete on this season's roster.
          or exists (
            select 1
            from public.season_roster sr
            join public.athletes a on a.id = sr.athlete_id
            where sr.season_id = s.id
              and a.guardian_user_id = auth.uid()
          )
          or exists (
            select 1
            from public.season_roster sr
            join public.athlete_guardian_links l on l.athlete_id = sr.athlete_id
            where sr.season_id = s.id
              and l.user_id = auth.uid()
          )
        )
    );
$$;

revoke all on function public.get_event_availability(uuid[]) from public;
grant execute on function public.get_event_availability(uuid[]) to authenticated;

create or replace function public.get_guardian_rosters()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as uid,
           nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') as email
  ),
  mine as (
    select at.id, at.first_name, at.last_name, at.avatar_url
      from public.athletes at
      cross join me
     where me.uid is not null
       -- One index-driven leg per way of being this athlete's guardian: the linked
       -- account, the guardian email, a connected extra guardian
       -- (athlete_guardian_links). An OR over them would stop the planner using the
       -- guardian_user_id / guardian_email indexes and scan every athlete.
       and at.id in (
         select a1.id from public.athletes a1 where a1.guardian_user_id = me.uid
         union
         select a2.id from public.athletes a2
          where me.email is not null and a2.guardian_email = me.email::citext
         union
         select l.athlete_id from public.athlete_guardian_links l where l.user_id = me.uid
       )
       -- SECURITY DEFINER skips athletes_read, so apply its predicate explicitly.
       -- Without this the email branch would return athletes RLS hides today (it has
       -- no guardian_email branch), which would be a permissions change rather than a
       -- performance fix. Evaluated once per matched athlete, not per nested row.
       and public.can_access_athlete(at.id)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'first_name', a.first_name,
        'last_name', a.last_name,
        'avatar_url', a.avatar_url,
        'tryout_participants', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', tp.id,
                'tryout_id', tp.tryout_id,
                'tryouts', jsonb_build_object('id', t.id, 'name', t.name, 'sport', t.sport),
                'evaluations', (
                  select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', e.id,
                        'session', e.session,
                        'recommendation', e.recommendation::text,
                        'created_at', e.created_at,
                        'evaluation_scores', (
                          select coalesce(
                            jsonb_agg(jsonb_build_object('rubric_key', s.rubric_key, 'value', s.value)),
                            '[]'::jsonb
                          )
                            from public.evaluation_scores s
                           where s.evaluation_id = e.id
                        )
                      )
                    ),
                    '[]'::jsonb
                  )
                    from public.evaluations e
                   where e.participant_id = tp.id
                )
              )
            ),
            '[]'::jsonb
          )
            from public.tryout_participants tp
            join public.tryouts t on t.id = tp.tryout_id
           where tp.athlete_id = a.id
             -- Same gate as participants_read / evaluations_read / eval_scores_rw,
             -- but evaluated once per tryout instead of once per score row.
             and public.can_access_tryout(tp.tryout_id)
             -- Deleted evaluation: soft_delete_tryout() only sets deleted_at, so
             -- without this the row keeps surfacing here forever.
             and t.deleted_at is null
             -- This one player removed from the evaluation (not the whole tryout
             -- deleted) — deletePlayer() only sets removed_at (20260915160000).
             and tp.removed_at is null
        ),
        'season_roster', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', sr.id,
                'jersey', sr.jersey,
                'fee_status', sr.fee_status,
                'event_availability', (
                  select coalesce(
                    jsonb_agg(jsonb_build_object(
                      'season_event_id', ea.season_event_id,
                      'response', ea.response::text
                    )),
                    '[]'::jsonb
                  )
                    from public.event_availability ea
                   where ea.roster_id = sr.id
                ),
                'seasons', jsonb_build_object(
                  'id', se.id,
                  'name', se.name,
                  'team_name', se.team_name,
                  'sport', se.sport,
                  'team_id', se.team_id,
                  'teams', case
                             when tm.id is null then null
                             else jsonb_build_object(
                               'collects_fees', tm.collects_fees,
                               'registration_fee_cents', tm.registration_fee_cents
                             )
                           end,
                  'season_events', (
                    -- Only events this athlete is actually scheduled for. The client
                    -- filtered these out client-side anyway, so this just stops the
                    -- whole season's calendar from crossing the wire per athlete.
                    select coalesce(
                      jsonb_agg(jsonb_build_object(
                        'id', ev.id,
                        'kind', ev.kind::text,
                        'title', ev.title,
                        'event_date', ev.event_date,
                        'start_time', ev.start_time,
                        'end_time', ev.end_time,
                        'location', ev.location,
                        'notes', ev.notes
                      )),
                      '[]'::jsonb
                    )
                      from public.season_events ev
                     where ev.season_id = se.id
                       and exists (
                         select 1 from public.event_availability ea2
                          where ea2.season_event_id = ev.id and ea2.roster_id = sr.id
                       )
                  )
                )
              )
            ),
            '[]'::jsonb
          )
            from public.season_roster sr
            join public.seasons se on se.id = sr.season_id
            left join public.teams tm on tm.id = se.team_id
           where sr.athlete_id = a.id
             -- Same gate as season_roster_read / seasons_read / season_events_read /
             -- availability_read, evaluated once per season.
             and public.can_access_season(sr.season_id)
             -- Deleted team/season: deleteTeam() archives both the team and its
             -- seasons (and 20260915120000 backfilled the older rows this missed),
             -- deleteSeason() hard-deletes the row outright. Either way, an
             -- archived season is gone from every coach-facing screen and must
             -- stop showing up for the guardian too.
             and se.archived = false
        )
      )
    ),
    '[]'::jsonb
  )
  from mine a;
$$;

revoke all on function public.get_guardian_rosters() from public;
grant execute on function public.get_guardian_rosters() to authenticated;

-- ---------------------------------------------------------------------------
-- Connect a family contact's login to the athlete
-- ---------------------------------------------------------------------------
-- Same authority as editing the athlete (athletes_write): account owner / admin /
-- coach, or a delegated manager of a team the athlete is on. The login must
-- belong to the contact's own email, so a contact row can't be used to connect
-- an arbitrary account. Idempotent. A login that is already the primary guardian
-- needs no link.
create or replace function public.link_family_contact_guardian(p_contact_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_account_id uuid;
  v_primary uuid;
  v_contact_email text;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select c.athlete_id, lower(nullif(trim(c.email), '')), a.account_id, a.guardian_user_id
    into v_athlete_id, v_contact_email, v_account_id, v_primary
  from public.athlete_family_contacts c
  join public.athletes a on a.id = c.athlete_id
  where c.id = p_contact_id;

  if v_athlete_id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  if not (
    public.has_account_role(v_account_id, array['owner','admin','coach']::membership_role[])
    or exists (
      select 1 from public.team_roster tr
      where tr.athlete_id = v_athlete_id and public.is_team_manager(tr.team_id)
    )
    or exists (
      select 1 from public.season_roster sr
      join public.seasons se on se.id = sr.season_id
      where sr.athlete_id = v_athlete_id and se.team_id is not null
        and public.is_team_manager(se.team_id)
    )
  ) then
    raise exception 'Not authorized to connect a guardian to this athlete' using errcode = '42501';
  end if;

  select lower(u.email) into v_user_email from auth.users u where u.id = p_user_id;
  if v_user_email is null or v_contact_email is null or v_user_email <> v_contact_email then
    raise exception 'That login does not match the contact''s email' using errcode = '22023';
  end if;

  if v_primary is not null and v_primary = p_user_id then
    return;
  end if;

  insert into public.athlete_guardian_links (athlete_id, user_id, contact_id, created_by)
  values (v_athlete_id, p_user_id, p_contact_id, auth.uid())
  on conflict (athlete_id, user_id) do nothing;
end;
$$;
revoke all on function public.link_family_contact_guardian(uuid, uuid) from public;
revoke execute on function public.link_family_contact_guardian(uuid, uuid) from anon;
grant execute on function public.link_family_contact_guardian(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A guardian removing the athlete from their own list
-- ---------------------------------------------------------------------------
-- Body from 20261001150000_guardian_rpc_null_auth_fix.sql. The primary guardian
-- still clears both link columns exactly as before. A connected extra guardian
-- drops only their own link; the athlete and the primary's access are untouched.
create or replace function public.guardian_remove_athlete(p_athlete_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  v_guardian_user_id uuid;
  v_guardian_email citext;
  v_found boolean := false;
  v_removed integer := 0;
begin
  select true, a.guardian_user_id, a.guardian_email
    into v_found, v_guardian_user_id, v_guardian_email
  from public.athletes a
  where a.id = p_athlete_id;

  if not coalesce(v_found, false) then
    raise exception 'Athlete not found' using errcode = 'P0002';
  end if;

  if (
    coalesce(v_guardian_user_id = auth.uid(), false)
    or coalesce(v_caller_email is not null and v_guardian_email = v_caller_email::citext, false)
  ) then
    update public.athletes
       set guardian_user_id = null,
           guardian_email = null
     where id = p_athlete_id;
    -- The primary guardian removing the player takes the family contacts with
    -- them; links to connected family members go too (contact_id cascades).
    delete from public.athlete_family_contacts where athlete_id = p_athlete_id;
    return;
  end if;

  delete from public.athlete_guardian_links
   where athlete_id = p_athlete_id and user_id = auth.uid();
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'Not authorized to remove this athlete' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.guardian_remove_athlete(uuid) from public;
revoke execute on function public.guardian_remove_athlete(uuid) from anon;
grant execute on function public.guardian_remove_athlete(uuid) to authenticated;
