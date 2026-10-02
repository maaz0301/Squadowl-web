-- Attach one team's calendar to another team.
--
-- Feedback from a coach: the Calendar menu should list the calendars you have
-- and let you attach or disconnect a calendar to other teams, so a team's hub
-- shows the events of the teams it follows (a club's facility, a sister team).
--
-- One row = "the viewer team's Calendar also shows the source team's events".
-- It is display only: nothing about either team's events, roster or RSVPs
-- changes, and removing the row simply stops the events showing. Events are not
-- copied, so edits to the source team's events appear on both calendars.
--
-- Writes need the right to manage both teams, so a calendar can only be
-- attached between teams the same person runs.
--
-- NOT APPLIED. Review, then apply with the rest of the migrations.

create table if not exists public.team_calendar_links (
  id              uuid primary key default gen_random_uuid(),
  viewer_team_id  uuid not null references public.teams(id) on delete cascade,
  source_team_id  uuid not null references public.teams(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (viewer_team_id, source_team_id),
  check (viewer_team_id <> source_team_id)
);

create index if not exists idx_team_calendar_links_source on public.team_calendar_links(source_team_id);

alter table public.team_calendar_links enable row level security;

drop policy if exists team_calendar_links_read on public.team_calendar_links;
create policy team_calendar_links_read on public.team_calendar_links
  for select using (public.can_manage_team(viewer_team_id) or public.can_manage_team(source_team_id));

drop policy if exists team_calendar_links_insert on public.team_calendar_links;
create policy team_calendar_links_insert on public.team_calendar_links
  for insert with check (public.can_manage_team(viewer_team_id) and public.can_manage_team(source_team_id));

drop policy if exists team_calendar_links_delete on public.team_calendar_links;
create policy team_calendar_links_delete on public.team_calendar_links
  for delete using (public.can_manage_team(viewer_team_id) or public.can_manage_team(source_team_id));
