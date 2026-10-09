-- Video Storage Add-On.
--
-- Coach+ and Club accounts can buy an annual storage add-on (1, 5 or 20 GB,
-- shared by every team on the account) and upload compressed videos to the
-- Library, player report cards, evaluation score rows and the team feed.
--
-- Every uploaded video has one row in account_videos. That registry is what the
-- quota counts, what the storage meter and the Account Settings -> Storage list
-- read, and what each integration points at (context + context_id), so a video
-- can only ever be stored once and counted once.
--
-- Quota is enforced here, not in the apps:
--   reserve_account_video()  checks the caller, the plan, the add-on and the
--                            remaining space, then hands back a storage path.
--   storage insert policy    only accepts a path that was reserved by the caller.
--   confirm_account_video()  re-reads the real object size, so a client cannot
--                            reserve 1 MB and upload 400 MB.
--
-- Retention: videos are never deleted because of age. They go only when the
-- add-on is cancelled, the plan drops below Coach+, or the account is deleted,
-- and then only at the end of the billing period already paid for. A daily
-- maintenance function (supabase/functions/video-storage-maintenance) sends the
-- 7 day and 1 day reminders and does the physical deletion from storage.

-- ── Account columns ─────────────────────────────────────────────────────────
alter table public.accounts
  add column if not exists video_storage_gb integer not null default 0,
  add column if not exists video_storage_source text,
  add column if not exists video_storage_sub_id text,
  -- When a cancelled add-on's paid period ends. Null while it renews normally.
  add column if not exists video_storage_cancel_at timestamptz,
  -- When the account last lost the right to store videos (add-on ended, or the
  -- plan fell below Coach+). Null while entitled.
  add column if not exists video_storage_ended_at timestamptz,
  add column if not exists video_managers_can_upload boolean not null default false,
  add column if not exists video_viewers_can_download boolean not null default false,
  add column if not exists video_reminder_7_sent_at timestamptz,
  add column if not exists video_reminder_1_sent_at timestamptz,
  -- Set when the coach typed DELETE on the second cancellation screen.
  add column if not exists video_deletion_ack_at timestamptz;

alter table public.accounts drop constraint if exists accounts_video_storage_gb_valid;
alter table public.accounts
  add constraint accounts_video_storage_gb_valid check (video_storage_gb in (0, 1, 5, 20));
alter table public.accounts drop constraint if exists accounts_video_storage_source_valid;
alter table public.accounts
  add constraint accounts_video_storage_source_valid
  check (video_storage_source is null or video_storage_source in ('stripe', 'apple', 'google'));

-- ── Registry ────────────────────────────────────────────────────────────────
create table if not exists public.account_videos (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  storage_path     text not null unique,
  file_name        text not null,
  title            text not null default '',
  size_bytes       bigint not null check (size_bytes > 0),
  content_type     text not null default 'video/mp4',
  duration_seconds integer,
  -- What the video is attached to. context_id is null until attach_account_video().
  context          text not null check (context in ('library', 'report_card', 'evaluation', 'team_post')),
  context_id       uuid,
  -- pending: space reserved, upload not confirmed. Pending rows older than an
  -- hour stop counting so an abandoned upload cannot hold quota forever.
  status           text not null default 'pending' check (status in ('pending', 'ready')),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  -- Set when the video is removed; the maintenance function then deletes the
  -- stored object and the row. Rows with this set never count and never show.
  purge_after      timestamptz
);
create index if not exists idx_account_videos_account on public.account_videos(account_id) where purge_after is null;
create index if not exists idx_account_videos_context on public.account_videos(context, context_id) where purge_after is null;
create index if not exists idx_account_videos_purge on public.account_videos(purge_after) where purge_after is not null;

alter table public.account_videos enable row level security;

-- Storage objects that must be removed but no longer have a registry row (the
-- account was deleted, which cascades the rows away).
create table if not exists public.account_video_purge_queue (
  storage_path text primary key,
  queued_at    timestamptz not null default now()
);
alter table public.account_video_purge_queue enable row level security;

-- ── Entitlement and quota ───────────────────────────────────────────────────
create or replace function public.video_storage_entitled(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ac.plan_tier::text in ('coach_plus', 'club') and ac.video_storage_gb > 0
       from public.accounts ac where ac.id = a),
    false);
$$;

create or replace function public.video_storage_quota_bytes(a uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select case when public.video_storage_entitled(a)
              then (select ac.video_storage_gb::bigint * 1073741824 from public.accounts ac where ac.id = a)
              else 0 end;
$$;

create or replace function public.video_storage_used_bytes(a uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.size_bytes), 0)::bigint
  from public.account_videos v
  where v.account_id = a
    and v.purge_after is null
    and (v.status = 'ready' or v.created_at > now() - interval '1 hour');
$$;

-- Owners, admins and coaches always; a delegated team manager only when the
-- coach has switched manager uploads on.
create or replace function public.can_upload_video(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.video_storage_entitled(a)
     and (
       public.has_account_role(a, array['owner','admin','coach']::membership_role[])
       or (
         coalesce((select ac.video_managers_can_upload from public.accounts ac where ac.id = a), false)
         and public.library_is_manager(a)
       )
     );
$$;

-- When the stored videos will be (or were) deleted. Null when nothing is
-- scheduled or there are no videos.
create or replace function public.video_deletion_date(a uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when not exists (
      select 1 from public.account_videos v
      where v.account_id = a and v.purge_after is null and v.status = 'ready'
    ) then null
    when ac.video_storage_ended_at is not null and not public.video_storage_entitled(a)
      then ac.video_storage_ended_at
    else least(
      case when ac.video_storage_gb > 0 then ac.video_storage_cancel_at end,
      ac.subscription_cancel_at,
      case when ac.pending_plan_tier is not null and ac.pending_plan_tier not in ('coach_plus', 'club')
           then ac.pending_plan_change_at end
    )
  end
  from public.accounts ac where ac.id = a;
$$;

grant execute on function
  public.video_storage_entitled(uuid), public.video_storage_quota_bytes(uuid),
  public.video_storage_used_bytes(uuid), public.can_upload_video(uuid),
  public.video_deletion_date(uuid)
  to authenticated;

-- ── Billing column guard + entitlement bookkeeping ──────────────────────────
-- accounts_update lets owners and admins write the row, so the columns that say
-- what was paid for must not be writable from a signed-in client. Only the
-- service role (the Stripe webhook, edge functions), SECURITY DEFINER
-- functions and SQL run as the table owner may change them.
create or replace function public.accounts_video_storage_touch()
returns trigger language plpgsql as $$
declare
  v_old_ent boolean;
  v_new_ent boolean;
begin
  -- current_user is the API role for a direct client write, and the function
  -- owner inside a SECURITY DEFINER function, so our own RPCs pass.
  if current_user in ('authenticated', 'anon') then
    new.video_storage_gb        := old.video_storage_gb;
    new.video_storage_source    := old.video_storage_source;
    new.video_storage_sub_id    := old.video_storage_sub_id;
    new.video_storage_cancel_at := old.video_storage_cancel_at;
    new.video_storage_ended_at  := old.video_storage_ended_at;
  end if;

  v_old_ent := old.plan_tier::text in ('coach_plus', 'club') and old.video_storage_gb > 0;
  v_new_ent := new.plan_tier::text in ('coach_plus', 'club') and new.video_storage_gb > 0;

  if v_old_ent and not v_new_ent then
    new.video_storage_ended_at := now();
  elsif v_new_ent then
    new.video_storage_ended_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists accounts_video_storage_touch on public.accounts;
create trigger accounts_video_storage_touch before update on public.accounts
  for each row execute function public.accounts_video_storage_touch();

-- Deleting an account cascades its registry rows away; remember the objects so
-- the maintenance function can still remove them from storage.
create or replace function public.accounts_video_storage_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.account_video_purge_queue (storage_path)
  select v.storage_path from public.account_videos v where v.account_id = old.id
  on conflict do nothing;
  return old;
end;
$$;
drop trigger if exists accounts_video_storage_before_delete on public.accounts;
create trigger accounts_video_storage_before_delete before delete on public.accounts
  for each row execute function public.accounts_video_storage_before_delete();

-- ── Read policy ─────────────────────────────────────────────────────────────
-- A video is visible to staff, to whoever uploaded it, and to anyone who can see
-- the thing it is attached to. The subqueries run as the caller, so each parent
-- table's own row level security decides (Library audience toggles, team feed
-- access, report card staff, evaluation access).
drop policy if exists account_videos_read on public.account_videos;
create policy account_videos_read on public.account_videos
  for select using (
    purge_after is null
    and (
      public.has_account_role(account_id, array['owner','admin','coach']::membership_role[])
      or created_by = auth.uid()
      or (context = 'library' and exists (select 1 from public.library_items li where li.id = context_id))
      or (context = 'team_post' and exists (select 1 from public.season_posts sp where sp.id = context_id))
      or (context = 'report_card' and exists (select 1 from public.player_report_cards rc where rc.id = context_id))
      or (context = 'evaluation' and exists (select 1 from public.evaluations ev where ev.id = context_id))
    )
  );

-- ── Overview for the meter and the Storage screen ───────────────────────────
create or replace function public.get_video_storage(p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ac public.accounts%rowtype;
  v_entitled boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.has_account_access(p_account_id) or public.library_is_manager(p_account_id)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into ac from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  v_entitled := public.video_storage_entitled(p_account_id);
  return jsonb_build_object(
    'accountId', ac.id,
    'planTier', ac.plan_tier::text,
    'planEligible', ac.plan_tier::text in ('coach_plus', 'club'),
    'gb', ac.video_storage_gb,
    'entitled', v_entitled,
    'source', ac.video_storage_source,
    'quotaBytes', public.video_storage_quota_bytes(p_account_id),
    'usedBytes', public.video_storage_used_bytes(p_account_id),
    'videoCount', (select count(*) from public.account_videos v
                    where v.account_id = p_account_id and v.purge_after is null and v.status = 'ready'),
    'canUpload', public.can_upload_video(p_account_id),
    'canManage', public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]),
    'managersCanUpload', ac.video_managers_can_upload,
    'viewersCanDownload', ac.video_viewers_can_download,
    'cancelAt', ac.video_storage_cancel_at,
    'endedAt', ac.video_storage_ended_at,
    'deletionAt', public.video_deletion_date(p_account_id)
  );
end;
$$;
grant execute on function public.get_video_storage(uuid) to authenticated;
revoke execute on function public.get_video_storage(uuid) from anon;

-- ── Permissions toggles ─────────────────────────────────────────────────────
create or replace function public.set_video_permissions(
  p_account_id uuid, p_managers_can_upload boolean, p_viewers_can_download boolean
) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin','coach']::membership_role[]) then
    raise exception 'Only the coach can change video permissions' using errcode = '42501';
  end if;
  update public.accounts
     set video_managers_can_upload = coalesce(p_managers_can_upload, video_managers_can_upload),
         video_viewers_can_download = coalesce(p_viewers_can_download, video_viewers_can_download)
   where id = p_account_id;
end;
$$;
grant execute on function public.set_video_permissions(uuid, boolean, boolean) to authenticated;
revoke execute on function public.set_video_permissions(uuid, boolean, boolean) from anon;

-- ── Upload: reserve, then confirm ───────────────────────────────────────────
create or replace function public.reserve_account_video(
  p_account_id uuid,
  p_file_name text,
  p_size_bytes bigint,
  p_content_type text,
  p_context text,
  p_title text default '',
  p_duration_seconds integer default null
) returns public.account_videos
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_quota bigint;
  v_used bigint;
  v_name text;
  v_row public.account_videos;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- Serialise uploads per account so two phones cannot both fit into the last gigabyte.
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if not public.video_storage_entitled(p_account_id) then
    raise exception 'Video storage is not active on this account. Add video storage to upload videos.' using errcode = '42501';
  end if;
  if not public.can_upload_video(p_account_id) then
    raise exception 'You do not have permission to upload videos for this account.' using errcode = '42501';
  end if;
  if p_context not in ('library', 'report_card', 'evaluation', 'team_post') then
    raise exception 'Unknown video context' using errcode = '22023';
  end if;
  if coalesce(p_size_bytes, 0) <= 0 then
    raise exception 'The video is empty.' using errcode = '22023';
  end if;
  if coalesce(p_content_type, '') <> 'video/mp4' then
    raise exception 'Videos are stored as MP4. Compress the video first.' using errcode = '22023';
  end if;

  v_quota := public.video_storage_quota_bytes(p_account_id);
  v_used := public.video_storage_used_bytes(p_account_id);
  if v_used + p_size_bytes > v_quota then
    raise exception 'storage_full: Video storage is full (% of % bytes used).', v_used, v_quota using errcode = '53100';
  end if;

  v_name := coalesce(nullif(regexp_replace(btrim(p_file_name), '[^A-Za-z0-9._-]+', '_', 'g'), ''), 'video.mp4');
  v_name := right(v_name, 120);

  insert into public.account_videos (
    id, account_id, storage_path, file_name, title, size_bytes, content_type,
    duration_seconds, context, status, created_by
  ) values (
    v_id, p_account_id, p_account_id::text || '/' || v_id::text || '/' || v_name, v_name,
    left(coalesce(p_title, ''), 200), p_size_bytes, 'video/mp4', p_duration_seconds, p_context, 'pending', auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.reserve_account_video(uuid, text, bigint, text, text, text, integer) to authenticated;
revoke execute on function public.reserve_account_video(uuid, text, bigint, text, text, text, integer) from anon;

-- Reads the real size of the uploaded object and keeps the row only if it fits.
create or replace function public.confirm_account_video(p_video_id uuid)
returns public.account_videos
language plpgsql volatile security definer set search_path = public as $$
declare
  v public.account_videos;
  v_actual bigint;
  v_quota bigint;
  v_others bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v from public.account_videos where id = p_video_id for update;
  if not found or v.purge_after is not null then
    raise exception 'That upload is no longer available.' using errcode = 'P0002';
  end if;
  if v.created_by <> auth.uid() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v.status = 'ready' then
    return v;
  end if;

  select (o.metadata ->> 'size')::bigint into v_actual
  from storage.objects o
  where o.bucket_id = 'account-videos' and o.name = v.storage_path;
  if v_actual is null or v_actual <= 0 then
    raise exception 'The upload did not finish. Try again.' using errcode = '22023';
  end if;

  perform 1 from public.accounts where id = v.account_id for update;
  v_quota := public.video_storage_quota_bytes(v.account_id);
  select coalesce(sum(x.size_bytes), 0) into v_others
  from public.account_videos x
  where x.account_id = v.account_id and x.id <> v.id and x.purge_after is null
    and (x.status = 'ready' or x.created_at > now() - interval '1 hour');

  if v_others + v_actual > v_quota then
    update public.account_videos set purge_after = now() where id = v.id;
    raise exception 'storage_full: Video storage is full.' using errcode = '53100';
  end if;

  update public.account_videos
     set status = 'ready', size_bytes = v_actual
   where id = v.id
   returning * into v;
  return v;
end;
$$;
grant execute on function public.confirm_account_video(uuid) to authenticated;
revoke execute on function public.confirm_account_video(uuid) from anon;

-- Point a finished upload at the thing it belongs to. Runs as the caller: the
-- target must be visible to them under its own row level security, and the
-- update below is only allowed on their own uploads (see the policy and guard).
create or replace function public.attach_account_video(p_video_id uuid, p_context text, p_context_id uuid)
returns void language plpgsql volatile security invoker set search_path = public as $$
declare
  v public.account_videos;
  v_ok boolean;
begin
  select * into v from public.account_videos where id = p_video_id;
  if not found then
    raise exception 'That video is no longer available.' using errcode = 'P0002';
  end if;
  if v.context <> p_context then
    raise exception 'That video was uploaded for something else.' using errcode = '22023';
  end if;

  v_ok := case p_context
    when 'library'     then exists (select 1 from public.library_items li where li.id = p_context_id and li.account_id = v.account_id)
    when 'team_post'   then exists (select 1 from public.season_posts sp where sp.id = p_context_id)
    when 'report_card' then exists (select 1 from public.player_report_cards rc where rc.id = p_context_id and rc.account_id = v.account_id)
    when 'evaluation'  then exists (select 1 from public.evaluations ev where ev.id = p_context_id)
    else false end;
  if not v_ok then
    raise exception 'Could not find what to attach the video to.' using errcode = 'P0002';
  end if;

  update public.account_videos set context_id = p_context_id where id = p_video_id;
  if not found then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.attach_account_video(uuid, text, uuid) to authenticated;
revoke execute on function public.attach_account_video(uuid, text, uuid) from anon;

-- Clients may update only their own rows, and only context_id (everything else
-- is put back by the guard), so the one thing they can do is attach.
drop policy if exists account_videos_attach on public.account_videos;
create policy account_videos_attach on public.account_videos
  for update using (created_by = auth.uid() and purge_after is null)
  with check (created_by = auth.uid() and purge_after is null);

create or replace function public.account_videos_guard()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.id := old.id;
    new.account_id := old.account_id;
    new.storage_path := old.storage_path;
    new.file_name := old.file_name;
    new.title := old.title;
    new.size_bytes := old.size_bytes;
    new.content_type := old.content_type;
    new.duration_seconds := old.duration_seconds;
    new.context := old.context;
    new.status := old.status;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.purge_after := old.purge_after;
  end if;
  return new;
end;
$$;
drop trigger if exists account_videos_guard on public.account_videos;
create trigger account_videos_guard before update on public.account_videos
  for each row execute function public.account_videos_guard();

-- Remove a video. Staff, or the person who uploaded it. A Library video takes
-- its Library item with it, since the item has nothing left to show.
create or replace function public.delete_account_video(p_video_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v public.account_videos;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v from public.account_videos where id = p_video_id;
  if not found or v.purge_after is not null then
    return;
  end if;
  if not (v.created_by = auth.uid()
          or public.has_account_role(v.account_id, array['owner','admin','coach']::membership_role[])) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.account_videos set purge_after = now() where id = v.id;
  if v.context = 'library' and v.context_id is not null then
    delete from public.library_items where id = v.context_id;
  end if;
end;
$$;
grant execute on function public.delete_account_video(uuid) to authenticated;
revoke execute on function public.delete_account_video(uuid) from anon;

-- ── Clean up when the thing a video was attached to goes away ──────────────
create or replace function public.account_videos_release_context()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_context text := tg_argv[0];
begin
  update public.account_videos
     set purge_after = now()
   where context = v_context and context_id = old.id and purge_after is null;
  return old;
end;
$$;

drop trigger if exists library_items_release_videos on public.library_items;
create trigger library_items_release_videos after delete on public.library_items
  for each row execute function public.account_videos_release_context('library');
drop trigger if exists season_posts_release_videos on public.season_posts;
create trigger season_posts_release_videos after delete on public.season_posts
  for each row execute function public.account_videos_release_context('team_post');
drop trigger if exists report_cards_release_videos on public.player_report_cards;
create trigger report_cards_release_videos after delete on public.player_report_cards
  for each row execute function public.account_videos_release_context('report_card');
drop trigger if exists evaluations_release_videos on public.evaluations;
create trigger evaluations_release_videos after delete on public.evaluations
  for each row execute function public.account_videos_release_context('evaluation');

-- ── Billing writes (service role only) ──────────────────────────────────────
-- State, not a counter, so a redelivered Stripe event is harmless.
create or replace function public.set_video_storage(
  p_account_id uuid,
  p_gb integer,
  p_source text,
  p_subscription_id text,
  p_cancel_at timestamptz default null
) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.accounts
     set video_storage_gb = coalesce(p_gb, 0),
         video_storage_source = case when coalesce(p_gb, 0) > 0 then p_source else null end,
         video_storage_sub_id = case when coalesce(p_gb, 0) > 0 then p_subscription_id else null end,
         video_storage_cancel_at = case when coalesce(p_gb, 0) > 0 then p_cancel_at else null end,
         -- A fresh or resumed add-on starts the reminder cycle over.
         video_reminder_7_sent_at = case when p_cancel_at is null then null else video_reminder_7_sent_at end,
         video_reminder_1_sent_at = case when p_cancel_at is null then null else video_reminder_1_sent_at end,
         video_deletion_ack_at = case when p_cancel_at is null then null else video_deletion_ack_at end
   where id = p_account_id;
end;
$$;
revoke all on function public.set_video_storage(uuid, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_video_storage(uuid, integer, text, text, timestamptz) to service_role;

create or replace function public.acknowledge_video_deletion(p_account_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_account_role(p_account_id, array['owner','admin']::membership_role[]) then
    raise exception 'Only the account owner can cancel video storage' using errcode = '42501';
  end if;
  update public.accounts set video_deletion_ack_at = now() where id = p_account_id;
end;
$$;
grant execute on function public.acknowledge_video_deletion(uuid) to authenticated;
revoke execute on function public.acknowledge_video_deletion(uuid) from anon;

-- Used by the maintenance function: every account whose videos have a deletion
-- date, with what the reminder emails need.
create or replace function public.video_accounts_with_deletion()
returns table (
  account_id uuid, account_name text, deletion_at timestamptz, entitled boolean,
  video_count bigint, used_bytes bigint,
  reminder_7_sent_at timestamptz, reminder_1_sent_at timestamptz, owner_email text
) language sql stable security definer set search_path = public as $$
  select ac.id, ac.name, public.video_deletion_date(ac.id), public.video_storage_entitled(ac.id),
         (select count(*) from public.account_videos v where v.account_id = ac.id and v.purge_after is null and v.status = 'ready'),
         public.video_storage_used_bytes(ac.id),
         ac.video_reminder_7_sent_at, ac.video_reminder_1_sent_at,
         (select p.email::text from public.memberships m join public.profiles p on p.id = m.user_id
           where m.account_id = ac.id and m.role = 'owner' order by m.created_at limit 1)
  from public.accounts ac
  where public.video_deletion_date(ac.id) is not null;
$$;
revoke all on function public.video_accounts_with_deletion() from public, anon, authenticated;
grant execute on function public.video_accounts_with_deletion() to service_role;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Keys are `<account id>/<video id>/<filename>`. Uploads are accepted only for a
-- path reserved above; reads follow the registry row, so they follow whatever
-- the video is attached to. There is no client delete policy: removal always
-- goes through delete_account_video() and the maintenance function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('account-videos', 'account-videos', false, 524288000, array['video/mp4'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists account_videos_storage_insert on storage.objects;
create policy account_videos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'account-videos'
    and exists (
      select 1 from public.account_videos v
      where v.storage_path = storage.objects.name
        and v.status = 'pending'
        and v.created_by = auth.uid()
        and v.purge_after is null
    )
  );

drop policy if exists account_videos_storage_read on storage.objects;
create policy account_videos_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'account-videos'
    and exists (select 1 from public.account_videos v where v.storage_path = storage.objects.name)
  );
