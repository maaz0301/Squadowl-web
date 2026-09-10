-- Email RSVP links — one unguessable token per (event, roster player).
--
-- Until now an RSVP could only be recorded from inside the app: the guardian
-- portal's Yes/Maybe/No buttons write event_availability directly as the signed
-- in guardian. The schedule email that announces an event carried no way to
-- respond, so a guardian who only ever reads email never RSVP'd at all and the
-- coach's Availability tab stayed on 'pending'.
--
-- These tokens are the capability that lets that guardian answer straight from
-- the email, without an account and without signing in. The link is the whole
-- credential, so the token is 64 hex characters (two gen_random_uuid()s) —
-- unguessable — and it grants exactly two things: read one event's details plus
-- the one player's name, and set that one player's response. Nothing else on
-- the season is reachable through it.
--
-- Why a side table rather than a column on event_availability: that table is
-- returned wholesale by get_event_availability() to every authorised reader,
-- which includes each guardian on the season. A token column there would hand
-- every guardian every *other* player's RSVP capability. Keeping tokens in
-- their own table with RLS on and no policies means no client can read them at
-- all — only the security-definer functions below, which never return a token
-- to anyone but a caller allowed to manage the season.

create table if not exists public.event_rsvp_tokens (
  token           text primary key
                    default (replace(gen_random_uuid()::text, '-', '')
                          || replace(gen_random_uuid()::text, '-', '')),
  season_event_id uuid not null references public.season_events(id) on delete cascade,
  roster_id       uuid not null references public.season_roster(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (season_event_id, roster_id)
);

create index if not exists event_rsvp_tokens_event_idx
  on public.event_rsvp_tokens (season_event_id);

alter table public.event_rsvp_tokens enable row level security;
-- Deliberately no policies: see the note above. Every read and write goes
-- through the security-definer functions below.

-- ─── Minting ────────────────────────────────────────────────────────────────
-- Called by the coach's client just before it sends the schedule email, once
-- per event. Idempotent: re-sending an invite (or editing the event and
-- notifying again) reuses the same token, so a link already sitting in a
-- guardian's inbox keeps working and a re-send does not orphan it.
--
-- Returns the guardian/player addresses alongside each token so the caller can
-- build one email per recipient without a second round trip.
create or replace function public.issue_event_rsvp_tokens(p_event_id uuid)
returns table (
  roster_id      uuid,
  player_name    text,
  player_email   text,
  guardian_email text,
  token          text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
-- The RETURNS TABLE columns above (roster_id, token, ...) become plpgsql
-- variables with the same names as the columns this body reads. Every
-- reference below is already table-qualified, but an unqualified one — an
-- ON CONFLICT target list, say — would otherwise resolve to the variable and
-- fail at runtime rather than at deploy time. The option above resolves such a
-- reference to the column, which is always what this function means.
begin
  if not exists (
    select 1
    from public.season_events se
    join public.seasons s on s.id = se.season_id
    where se.id = p_event_id
      and (
        public.has_account_access(s.account_id)
        or (s.team_id is not null and public.can_manage_team(s.team_id))
      )
  ) then
    raise exception 'Not allowed to issue RSVP links for this event.'
      using errcode = '42501';
  end if;

  -- One token per player actually invited to the event. event_availability is
  -- the invite list (createSeasonEvent seeds a 'pending' row per selected
  -- player), so joining through it keeps links and invitations in step.
  insert into public.event_rsvp_tokens (season_event_id, roster_id)
  select ea.season_event_id, ea.roster_id
  from public.event_availability ea
  where ea.season_event_id = p_event_id
  on conflict (season_event_id, roster_id) do nothing;

  return query
  select
    t.roster_id,
    btrim(a.first_name || ' ' || a.last_name),
    sr.player_email::text,
    a.guardian_email::text,
    t.token
  from public.event_rsvp_tokens t
  join public.season_roster sr on sr.id = t.roster_id
  join public.athletes a on a.id = sr.athlete_id
  where t.season_event_id = p_event_id;
end;
$$;

revoke all on function public.issue_event_rsvp_tokens(uuid) from public;
grant execute on function public.issue_event_rsvp_tokens(uuid) to authenticated;

-- ─── Reading one link's event ───────────────────────────────────────────────
-- Powers the /rsvp/<token> landing page, which has to render before the
-- recipient has done anything — and for a recipient who is very often not
-- signed in, hence the anon grant.
create or replace function public.get_event_rsvp_context(p_token text)
returns table (
  event_id    uuid,
  kind        text,
  title       text,
  event_date  date,
  start_time  text,
  end_time    text,
  location    text,
  notes       text,
  season_name text,
  team_name   text,
  player_name text,
  response    public.availability_option
)
language sql
stable
security definer
set search_path = public
as $$
  select
    se.id,
    se.kind::text,
    se.title,
    se.event_date,
    se.start_time,
    se.end_time,
    se.location,
    se.notes,
    s.name,
    s.team_name,
    btrim(a.first_name || ' ' || a.last_name),
    ea.response
  from public.event_rsvp_tokens t
  join public.season_events se on se.id = t.season_event_id
  join public.seasons s on s.id = se.season_id
  join public.season_roster sr on sr.id = t.roster_id
  join public.athletes a on a.id = sr.athlete_id
  left join public.event_availability ea
    on ea.season_event_id = t.season_event_id
   and ea.roster_id = t.roster_id
  where t.token = p_token;
$$;

revoke all on function public.get_event_rsvp_context(text) from public;
grant execute on function public.get_event_rsvp_context(text) to anon, authenticated;

-- ─── Recording the answer ───────────────────────────────────────────────────
-- Writes the same event_availability row the in-app portal buttons write, so
-- an emailed RSVP and an in-app RSVP are indistinguishable to the coach's
-- Availability and Attendance tabs — there is no second source of truth.
--
-- responded_by is set only when the click happens to come from a signed-in
-- session; an emailed answer legitimately has no auth.uid() behind it.
create or replace function public.submit_event_rsvp(p_token text, p_response text)
returns table (
  event_id    uuid,
  kind        text,
  title       text,
  event_date  date,
  start_time  text,
  end_time    text,
  location    text,
  notes       text,
  season_name text,
  team_name   text,
  player_name text,
  response    public.availability_option
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
-- Same reason as issue_event_rsvp_tokens: `response`, `title` and friends are
-- both output parameters here and columns of the tables below.
declare
  v_event  uuid;
  v_roster uuid;
begin
  if p_response not in ('yes', 'maybe', 'no') then
    raise exception 'Invalid RSVP response: %', p_response using errcode = '22023';
  end if;

  select t.season_event_id, t.roster_id into v_event, v_roster
  from public.event_rsvp_tokens t
  where t.token = p_token;

  if v_event is null then
    raise exception 'This RSVP link is no longer valid.' using errcode = '22023';
  end if;

  insert into public.event_availability (season_event_id, roster_id, response, responded_by, updated_at)
  values (v_event, v_roster, p_response::public.availability_option, auth.uid(), now())
  on conflict (season_event_id, roster_id) do update
    set response     = excluded.response,
        responded_by = coalesce(excluded.responded_by, event_availability.responded_by),
        updated_at   = now();

  return query select * from public.get_event_rsvp_context(p_token);
end;
$$;

revoke all on function public.submit_event_rsvp(text, text) from public;
grant execute on function public.submit_event_rsvp(text, text) to anon, authenticated;
