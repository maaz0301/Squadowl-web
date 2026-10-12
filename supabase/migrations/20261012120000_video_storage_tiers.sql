-- Video storage: the final pricing and who may buy it.
--
--   Starter 1 GB, Standard 5 GB, Pro 25 GB, Elite 100 GB (CAD per year; no free storage).
--   Available to Coach, Coach+ and Club (it was Coach+ and Club only).
--
-- An assessor assigned to an assessment may upload too, under the same coach
-- switch as managers. Everything they upload counts against the account owner's storage.


-- The old size check goes first, so accounts can move off the retired 20 GB size.
alter table public.accounts drop constraint if exists accounts_video_storage_gb_valid;

-- The old 20 GB size no longer exists: accounts on it move up to the new 25 GB Pro size
-- (never down, so nobody loses space), before the new size list is enforced.
update public.accounts set video_storage_gb = 25 where video_storage_gb = 20;

alter table public.accounts
  add constraint accounts_video_storage_gb_valid check (video_storage_gb in (0, 1, 5, 25, 100));

create or replace function public.video_storage_entitled(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ac.plan_tier::text in ('coach', 'coach_plus', 'club') and ac.video_storage_gb > 0
       from public.accounts ac where ac.id = a),
    false);
$$;

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
      case when ac.pending_plan_tier is not null and ac.pending_plan_tier not in ('coach', 'coach_plus', 'club')
           then ac.pending_plan_change_at end
    )
  end
  from public.accounts ac where ac.id = a;
$$;

create or replace function public.get_video_storage(p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ac public.accounts%rowtype;
  v_entitled boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.has_account_access(p_account_id) or public.library_is_manager(p_account_id) or public.library_is_assessor(p_account_id)) then
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
    'planEligible', ac.plan_tier::text in ('coach', 'coach_plus', 'club'),
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

  v_old_ent := old.plan_tier::text in ('coach', 'coach_plus', 'club') and old.video_storage_gb > 0;
  v_new_ent := new.plan_tier::text in ('coach', 'coach_plus', 'club') and new.video_storage_gb > 0;

  if v_old_ent and not v_new_ent then
    new.video_storage_ended_at := now();
  elsif v_new_ent then
    new.video_storage_ended_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.can_upload_video(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.video_storage_entitled(a)
     and (
       public.has_account_role(a, array['owner','admin','coach']::membership_role[])
       or (
         coalesce((select ac.video_managers_can_upload from public.accounts ac where ac.id = a), false)
         and (public.library_is_manager(a) or public.library_is_assessor(a))
       )
     );
$$;
