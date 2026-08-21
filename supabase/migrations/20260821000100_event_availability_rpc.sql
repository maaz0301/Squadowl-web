-- get_event_availability(uuid[]) — read an event's RSVPs without paying the
-- row-level policy per row.
--
-- Reading event_availability directly makes Postgres evaluate the table's
-- SELECT policy once per RSVP row. On a full-roster event (1,000+ players) that
-- overruns the 8s statement timeout and comes back 57014 before any rows are
-- returned. Client-side paging does not help: the policy runs on candidate rows
-- *before* LIMIT applies, so `limit=500` on a single event times out exactly as
-- an unbounded read does.
--
-- Same shape of fix as get_guardian_rosters(): authorize once per event, then
-- return that event's rows in bulk.
--
-- APPLY 20260821000000_event_availability_indexes.sql FIRST and re-test. That
-- one is risk-free, and a missing index on season_event_id alone can cause this
-- timeout — in which case none of the below is needed.
--
-- NOTE FOR REVIEW: the authorization below is reconstructed from how the app
-- uses this data, not copied from the existing event_availability policy — that
-- policy lives in this backend repo and must be the source of truth. Diff the
-- WHERE clause against it before applying, and widen or narrow to match
-- exactly. The point of the function is to change *when* the check runs, never
-- *what* it permits.

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
        )
    );
$$;

revoke all on function public.get_event_availability(uuid[]) from public;
grant execute on function public.get_event_availability(uuid[]) to authenticated;

-- Indexes that drive the per-event EXISTS live in the companion indexes
-- migration, which should already have been applied.
