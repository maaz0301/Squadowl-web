-- Step 1 of the event_availability 57014 fix: indexes only.
--
-- Safe to apply as-is — it changes no policy and grants no access, so it cannot
-- widen what anyone can read. Try this before the RPC in the companion
-- migration and re-test; if a missing index was the whole problem, the RPC
-- (which bypasses RLS and therefore needs careful review) is not needed at all.
--
-- Why an index matters so much here: reading event_availability evaluates the
-- row-level policy per row. Without an index on season_event_id, Postgres
-- seq-scans the whole table and runs that policy on every row in it, not just
-- the ones belonging to the event being asked for.

create index if not exists event_availability_season_event_id_idx
  on public.event_availability (season_event_id);

-- These back the lookups a per-row policy on this table typically performs.
create index if not exists season_roster_season_id_idx
  on public.season_roster (season_id);

create index if not exists season_roster_athlete_id_idx
  on public.season_roster (athlete_id);

create index if not exists season_events_season_id_idx
  on public.season_events (season_id);

create index if not exists athletes_guardian_user_id_idx
  on public.athletes (guardian_user_id);

analyze public.event_availability;
analyze public.season_roster;
