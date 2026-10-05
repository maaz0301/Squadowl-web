-- Library: files, notes, videos and links an account stores once and shares
-- with chosen audiences.
--
-- Owners and admins manage the library and always see everything in it. Each
-- item then carries one toggle per audience (coaches, managers, assessors,
-- players, guardians); a person sees an item only if the toggle for a role they
-- hold on this account is on. The toggles are enforced here, in row level
-- security, not just hidden in the apps.
--
-- Roles, as the database can tell them apart:
--   coaches    members of the account with the 'coach' role
--   managers   people a team of the account was delegated to (team_managers)
--   assessors  members with the 'assessor' role, or invited (and not declined)
--              on one of the account's evaluations
--   players    portal users whose sign-in email is the athlete's player email
--   guardians  any other portal user linked to an athlete of the account
-- Uploads live in a private bucket and are reached through signed URLs.

create table if not exists public.library_items (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  kind          text not null check (kind in ('file', 'note', 'video', 'link')),
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  -- Note text, or a description of a file/video/link.
  body          text not null default '' check (char_length(body) <= 20000),
  -- External address, for a link or a video hosted elsewhere (YouTube, Vimeo).
  url           text check (url is null or char_length(url) <= 2000),
  -- Uploaded file or video.
  file_name     text,
  file_path     text,
  file_size     bigint not null default 0,
  content_type  text,
  for_coaches    boolean not null default true,
  for_managers   boolean not null default false,
  for_assessors  boolean not null default false,
  for_players    boolean not null default false,
  for_guardians  boolean not null default false,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_library_items_account on public.library_items(account_id, created_at desc);

alter table public.library_items enable row level security;

-- ── Role predicates ─────────────────────────────────────────────────────────
create or replace function public.library_is_manager(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_managers tm
    join public.teams te on te.id = tm.team_id
    where tm.user_id = auth.uid() and te.account_id = a
  );
$$;

create or replace function public.library_is_assessor(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_account_role(a, array['assessor']::membership_role[])
    or exists (
      select 1 from public.tryout_assessors ta
      join public.tryouts ty on ty.id = ta.tryout_id
      where ta.user_id = auth.uid()
        and ty.account_id = a
        and ty.deleted_at is null
        and coalesce(ta.status, 'accepted') <> 'declined'
    );
$$;

-- Athletes the caller is linked to (as guardian or player) that belong to the
-- account, directly or through one of its seasons.
create or replace function public.library_linked_athletes(a uuid)
returns table (player_email text)
language sql stable security definer set search_path = public as $$
  select at.player_email::text
  from public.athletes at
  where at.guardian_user_id = auth.uid()
    and (
      at.account_id = a
      or exists (
        select 1 from public.season_roster sr
        join public.seasons se on se.id = sr.season_id
        where sr.athlete_id = at.id and se.account_id = a
      )
    );
$$;

create or replace function public.library_is_player(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.library_linked_athletes(a) la
    join public.profiles p on p.id = auth.uid()
    where la.player_email is not null and lower(la.player_email) = lower(p.email::text)
  );
$$;

create or replace function public.library_is_guardian(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.library_linked_athletes(a) la
    left join public.profiles p on p.id = auth.uid()
    where la.player_email is null or lower(la.player_email) <> lower(coalesce(p.email::text, ''))
  );
$$;

-- Owners and admins (and platform admins, via has_account_role).
create or replace function public.library_can_manage(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_account_role(a, array['owner','admin']::membership_role[]);
$$;

create or replace function public.library_can_view(
  a uuid, p_coaches boolean, p_managers boolean, p_assessors boolean, p_players boolean, p_guardians boolean
) returns boolean language sql stable security definer set search_path = public as $$
  select public.library_can_manage(a)
    or (p_coaches   and public.has_account_role(a, array['coach']::membership_role[]))
    or (p_managers  and public.library_is_manager(a))
    or (p_assessors and public.library_is_assessor(a))
    or (p_players   and public.library_is_player(a))
    or (p_guardians and public.library_is_guardian(a));
$$;

grant execute on function public.library_is_manager(uuid), public.library_is_assessor(uuid),
  public.library_linked_athletes(uuid), public.library_is_player(uuid), public.library_is_guardian(uuid),
  public.library_can_manage(uuid), public.library_can_view(uuid, boolean, boolean, boolean, boolean, boolean)
  to authenticated;

-- ── Policies ────────────────────────────────────────────────────────────────
drop policy if exists library_items_read on public.library_items;
create policy library_items_read on public.library_items
  for select using (
    public.library_can_view(account_id, for_coaches, for_managers, for_assessors, for_players, for_guardians)
  );

drop policy if exists library_items_write on public.library_items;
create policy library_items_write on public.library_items
  for all using (public.library_can_manage(account_id))
  with check (public.library_can_manage(account_id));

-- The author is whoever inserts, and an update cannot rewrite who created the
-- item or move it to another account.
create or replace function public.library_items_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.account_id := old.account_id;
  end if;
  return new;
end;
$$;
drop trigger if exists library_items_touch on public.library_items;
create trigger library_items_touch before insert or update on public.library_items
  for each row execute function public.library_items_touch();

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Keys are `<account id>/<item id>/<upload id>/<filename>`; the first segment
-- is what the write policies check. Reading follows the item's own policy, so
-- a toggled-off audience cannot fetch the file even with the path in hand.
insert into storage.buckets (id, name, public, file_size_limit)
values ('library-files', 'library-files', false, 52428800)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists library_files_storage_insert on storage.objects;
create policy library_files_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library-files'
              and public.library_can_manage(((storage.foldername(name))[1])::uuid));

drop policy if exists library_files_storage_read on storage.objects;
create policy library_files_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'library-files'
         and exists (select 1 from public.library_items li where li.file_path = storage.objects.name));

drop policy if exists library_files_storage_delete on storage.objects;
create policy library_files_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'library-files'
         and public.library_can_manage(((storage.foldername(name))[1])::uuid));
