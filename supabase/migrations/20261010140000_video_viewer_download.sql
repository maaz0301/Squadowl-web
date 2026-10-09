-- Whether viewers (players, guardians) may download a video. The coach's switch
-- lives on the account, but a viewer cannot read the account row, so each video
-- carries a copy that row level security already lets them see. Defaults to off:
-- viewers watch only.
alter table public.account_videos
  add column if not exists viewers_can_download boolean not null default false;

create or replace function public.account_videos_default_download()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.viewers_can_download := coalesce(
    (select ac.video_viewers_can_download from public.accounts ac where ac.id = new.account_id), false);
  return new;
end;
$$;
drop trigger if exists account_videos_default_download on public.account_videos;
create trigger account_videos_default_download before insert on public.account_videos
  for each row execute function public.account_videos_default_download();

-- Clients may still only change context_id; the new column is put back too.
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
    new.viewers_can_download := old.viewers_can_download;
  end if;
  return new;
end;
$$;

-- Changing the switch updates every video already stored.
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
  if p_viewers_can_download is not null then
    update public.account_videos set viewers_can_download = p_viewers_can_download where account_id = p_account_id;
  end if;
end;
$$;
