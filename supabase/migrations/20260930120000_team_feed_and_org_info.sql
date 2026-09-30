-- Team news feed and organization info.
--
-- Team feed: coaches (account staff or the team's manager) post updates to a
-- season; everyone who can open the season (staff, a team manager, a guardian
-- with an athlete on the roster) reads them, comments, and downloads any files
-- the coach attached.
--
-- Organization info: staff of an account post information that applies to every
-- team it runs (testing info, competition info, links, documents). Everyone who
-- can open ANY of the account's seasons can read it; only owner/admin/coach
-- staff write it.
--
-- Files live in private buckets and are reached through signed URLs. Keys are
-- `<season id>/<post id>/<upload id>/<filename>` (feed-files) and
-- `<account id>/<info id>/<upload id>/<filename>` (org-info-files): the first
-- segment is what the storage policies check.

-- Staff on the account.
create or replace function public.can_manage_account_info(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_account_role(a, array['owner','admin','coach']::membership_role[]);
$$;

-- Staff on the account, or anyone who can open one of its seasons.
create or replace function public.can_view_account_info(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_account_role(a, array['owner','admin','coach','assessor']::membership_role[])
    or exists (
      select 1 from public.seasons se
      where se.account_id = a and public.can_access_season(se.id)
    );
$$;

-- ── Team feed ───────────────────────────────────────────────────────────────
create table if not exists public.season_posts (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references public.seasons(id) on delete cascade,
  author_user_id uuid not null default auth.uid(),
  author_name    text not null default '',
  title          text not null default '' check (char_length(title) <= 200),
  body           text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at     timestamptz not null default now()
);
create index if not exists idx_season_posts_season on public.season_posts(season_id, created_at desc);

create table if not exists public.season_post_comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.season_posts(id) on delete cascade,
  author_user_id uuid not null default auth.uid(),
  author_name    text not null default '',
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists idx_season_post_comments_post on public.season_post_comments(post_id, created_at);

create table if not exists public.season_post_files (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.season_posts(id) on delete cascade,
  name         text not null,
  path         text not null,
  size         bigint not null default 0,
  content_type text not null default 'application/octet-stream',
  uploaded_by  uuid not null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_season_post_files_post on public.season_post_files(post_id, created_at);

alter table public.season_posts enable row level security;
alter table public.season_post_comments enable row level security;
alter table public.season_post_files enable row level security;

drop policy if exists season_posts_read on public.season_posts;
create policy season_posts_read on public.season_posts
  for select using (public.can_access_season(season_id));

drop policy if exists season_posts_write on public.season_posts;
create policy season_posts_write on public.season_posts
  for all using (public.can_manage_season(season_id))
  with check (public.can_manage_season(season_id) and author_user_id = auth.uid());

drop policy if exists post_comments_read on public.season_post_comments;
create policy post_comments_read on public.season_post_comments
  for select using (exists (
    select 1 from public.season_posts p
    where p.id = post_id and public.can_access_season(p.season_id)));

drop policy if exists post_comments_insert on public.season_post_comments;
create policy post_comments_insert on public.season_post_comments
  for insert with check (
    author_user_id = auth.uid()
    and exists (select 1 from public.season_posts p
                where p.id = post_id and public.can_access_season(p.season_id)));

-- Own comments, or any comment for staff moderating their team's feed.
drop policy if exists post_comments_delete on public.season_post_comments;
create policy post_comments_delete on public.season_post_comments
  for delete using (
    author_user_id = auth.uid()
    or exists (select 1 from public.season_posts p
               where p.id = post_id and public.can_manage_season(p.season_id)));

drop policy if exists post_files_read on public.season_post_files;
create policy post_files_read on public.season_post_files
  for select using (exists (
    select 1 from public.season_posts p
    where p.id = post_id and public.can_access_season(p.season_id)));

drop policy if exists post_files_write on public.season_post_files;
create policy post_files_write on public.season_post_files
  for all using (exists (
    select 1 from public.season_posts p
    where p.id = post_id and public.can_manage_season(p.season_id)))
  with check (exists (
    select 1 from public.season_posts p
    where p.id = post_id and public.can_manage_season(p.season_id)));

insert into storage.buckets (id, name, public, file_size_limit)
values ('feed-files', 'feed-files', false, 20971520)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists feed_files_storage_insert on storage.objects;
create policy feed_files_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feed-files'
              and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then public.can_manage_season(((storage.foldername(name))[1])::uuid) else false end);

drop policy if exists feed_files_storage_read on storage.objects;
create policy feed_files_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'feed-files'
         and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then public.can_access_season(((storage.foldername(name))[1])::uuid) else false end);

drop policy if exists feed_files_storage_delete on storage.objects;
create policy feed_files_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'feed-files'
         and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then public.can_manage_season(((storage.foldername(name))[1])::uuid) else false end);

-- ── Organization info ───────────────────────────────────────────────────────
create table if not exists public.account_info_items (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  category       text not null default 'announcement'
                   check (category in ('testing','competition','links','documents','announcement')),
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  body           text not null default '' check (char_length(body) <= 5000),
  url            text not null default '' check (char_length(url) <= 2000),
  author_user_id uuid not null default auth.uid(),
  author_name    text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists idx_account_info_items_account on public.account_info_items(account_id, created_at desc);

create table if not exists public.account_info_files (
  id           uuid primary key default gen_random_uuid(),
  info_id      uuid not null references public.account_info_items(id) on delete cascade,
  name         text not null,
  path         text not null,
  size         bigint not null default 0,
  content_type text not null default 'application/octet-stream',
  uploaded_by  uuid not null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_account_info_files_info on public.account_info_files(info_id, created_at);

alter table public.account_info_items enable row level security;
alter table public.account_info_files enable row level security;

drop policy if exists account_info_read on public.account_info_items;
create policy account_info_read on public.account_info_items
  for select using (public.can_view_account_info(account_id));

drop policy if exists account_info_write on public.account_info_items;
create policy account_info_write on public.account_info_items
  for all using (public.can_manage_account_info(account_id))
  with check (public.can_manage_account_info(account_id) and author_user_id = auth.uid());

drop policy if exists account_info_files_read on public.account_info_files;
create policy account_info_files_read on public.account_info_files
  for select using (exists (
    select 1 from public.account_info_items i
    where i.id = info_id and public.can_view_account_info(i.account_id)));

drop policy if exists account_info_files_write on public.account_info_files;
create policy account_info_files_write on public.account_info_files
  for all using (exists (
    select 1 from public.account_info_items i
    where i.id = info_id and public.can_manage_account_info(i.account_id)))
  with check (exists (
    select 1 from public.account_info_items i
    where i.id = info_id and public.can_manage_account_info(i.account_id)));

insert into storage.buckets (id, name, public, file_size_limit)
values ('org-info-files', 'org-info-files', false, 20971520)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists org_info_storage_insert on storage.objects;
create policy org_info_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-info-files'
              and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then public.can_manage_account_info(((storage.foldername(name))[1])::uuid) else false end);

drop policy if exists org_info_storage_read on storage.objects;
create policy org_info_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'org-info-files'
         and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then public.can_view_account_info(((storage.foldername(name))[1])::uuid) else false end);

drop policy if exists org_info_storage_delete on storage.objects;
create policy org_info_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'org-info-files'
         and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then public.can_manage_account_info(((storage.foldername(name))[1])::uuid) else false end);
