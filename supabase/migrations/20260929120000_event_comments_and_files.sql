-- Event comments and files.
--
-- Comments: anyone who can open the season (staff, a team manager, or a
-- guardian with an athlete on its roster) can read the thread and post to it.
-- Guardians speak for their athlete, so the author is the signed-in user with
-- their display name stored on the row.
--
-- Files: coaches (account staff or the team's manager) attach files to a
-- specific event; everyone who can open the season can read them. The bucket
-- is private and files are reached through signed URLs.

-- Staff on the season's account, or the manager of its team.
create or replace function public.can_manage_season(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seasons se where se.id = s and (
      public.has_account_role(se.account_id, array['owner','admin','coach']::membership_role[])
      or (se.team_id is not null and public.is_team_manager(se.team_id))
    )
  );
$$;

create table if not exists public.season_event_comments (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.season_events(id) on delete cascade,
  author_user_id uuid not null default auth.uid(),
  author_name    text not null default '',
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists idx_season_event_comments_event on public.season_event_comments(event_id, created_at);

create table if not exists public.season_event_files (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.season_events(id) on delete cascade,
  name         text not null,
  path         text not null,
  size         bigint not null default 0,
  content_type text not null default 'application/octet-stream',
  uploaded_by  uuid not null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_season_event_files_event on public.season_event_files(event_id, created_at);

alter table public.season_event_comments enable row level security;
alter table public.season_event_files enable row level security;

drop policy if exists event_comments_read on public.season_event_comments;
create policy event_comments_read on public.season_event_comments
  for select using (exists (
    select 1 from public.season_events ev
    where ev.id = event_id and public.can_access_season(ev.season_id)));

drop policy if exists event_comments_insert on public.season_event_comments;
create policy event_comments_insert on public.season_event_comments
  for insert with check (
    author_user_id = auth.uid()
    and exists (select 1 from public.season_events ev
                where ev.id = event_id and public.can_access_season(ev.season_id)));

-- Own comments, or any comment for staff moderating their team's thread.
drop policy if exists event_comments_delete on public.season_event_comments;
create policy event_comments_delete on public.season_event_comments
  for delete using (
    author_user_id = auth.uid()
    or exists (select 1 from public.season_events ev
               where ev.id = event_id and public.can_manage_season(ev.season_id)));

drop policy if exists event_files_read on public.season_event_files;
create policy event_files_read on public.season_event_files
  for select using (exists (
    select 1 from public.season_events ev
    where ev.id = event_id and public.can_access_season(ev.season_id)));

drop policy if exists event_files_write on public.season_event_files;
create policy event_files_write on public.season_event_files
  for all using (exists (
    select 1 from public.season_events ev
    where ev.id = event_id and public.can_manage_season(ev.season_id)))
  with check (exists (
    select 1 from public.season_events ev
    where ev.id = event_id and public.can_manage_season(ev.season_id)));

-- Keys are `<season id>/<event id>/<upload id>/<filename>`: the first segment
-- is what the policies check.
insert into storage.buckets (id, name, public, file_size_limit)
values ('event-files', 'event-files', false, 20971520)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists event_files_storage_insert on storage.objects;
create policy event_files_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-files'
              and public.can_manage_season(((storage.foldername(name))[1])::uuid));

drop policy if exists event_files_storage_read on storage.objects;
create policy event_files_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'event-files'
         and public.can_access_season(((storage.foldername(name))[1])::uuid));

drop policy if exists event_files_storage_delete on storage.objects;
create policy event_files_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-files'
         and public.can_manage_season(((storage.foldername(name))[1])::uuid));
