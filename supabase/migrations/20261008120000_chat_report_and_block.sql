-- ============================================================================
-- Team chat: report a message, block a person
-- ----------------------------------------------------------------------------
-- Google Play (user generated content policy) expects a way to report abusive
-- content and to block the person posting it. Both live here.
--
-- Blocking is personal and one-way: it hides someone's chat messages from the
-- blocker and silences their push notifications to the blocker. It does not
-- remove the person from the team and does not change what anyone else sees, so
-- a coach can still moderate (delete) any message under season_messages_delete.
--
-- Reporting snapshots the message at the moment of the report, so the evidence
-- survives the author deleting it. Reports are readable only by their reporter;
-- they are reviewed by the platform operators through the service role.
-- ============================================================================

-- ---- Blocks -----------------------------------------------------------------
create table public.user_blocks (
  blocker_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  -- Kept so the "Blocked people" list can show a name without having to read
  -- another user's profile, which the blocker may not be allowed to do.
  blocked_name    text not null default '',
  created_at      timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

alter table public.user_blocks enable row level security;

create policy user_blocks_select on public.user_blocks
  for select using (blocker_user_id = auth.uid());

create policy user_blocks_delete on public.user_blocks
  for delete using (blocker_user_id = auth.uid());

-- No INSERT policy: blocking goes through block_chat_user() so the name is
-- filled in server-side rather than trusted from the client.

create or replace function public.block_chat_user(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot block yourself';
  end if;

  select coalesce(nullif(btrim(display_name), ''), 'Unknown') into v_name
    from public.profiles where id = p_user_id;
  if not found then
    raise exception 'That person could not be found';
  end if;

  insert into public.user_blocks (blocker_user_id, blocked_user_id, blocked_name)
  values (auth.uid(), p_user_id, v_name)
  on conflict (blocker_user_id, blocked_user_id) do nothing;
end;
$$;

revoke all on function public.block_chat_user(uuid) from public, anon;
grant execute on function public.block_chat_user(uuid) to authenticated;

-- ---- Reports ----------------------------------------------------------------
create table public.message_reports (
  id               uuid primary key default gen_random_uuid(),
  -- Null once the message itself is gone; the snapshot below is what remains.
  message_id       uuid references public.season_messages(id) on delete set null,
  season_id        uuid not null references public.seasons(id) on delete cascade,
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reported_name    text not null,
  message_body     text not null,
  reason           text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  details          text check (details is null or char_length(details) <= 1000),
  status           text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at       timestamptz not null default now(),
  unique (message_id, reporter_user_id)
);

create index idx_message_reports_status on public.message_reports (status, created_at desc);

alter table public.message_reports enable row level security;

-- Only the reporter, so a report against a coach is never visible to that coach.
create policy message_reports_select on public.message_reports
  for select using (reporter_user_id = auth.uid());

create or replace function public.report_season_message(
  p_message_id uuid,
  p_reason     text,
  p_details    text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_msg     public.season_messages;
  v_id      uuid;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;
  if p_reason not in ('spam', 'harassment', 'inappropriate', 'other') then
    raise exception 'Choose a reason for the report';
  end if;
  if v_details is not null and char_length(v_details) > 1000 then
    raise exception 'Details are too long (1000 characters max)';
  end if;

  select * into v_msg from public.season_messages where id = p_message_id;
  if not found then
    raise exception 'That message no longer exists';
  end if;
  -- SECURITY DEFINER skips season_messages_select, so repeat its gate: you can
  -- only report what you were able to read.
  if not public.can_access_season(v_msg.season_id) then
    raise exception 'Not authorized to report this message';
  end if;
  if v_msg.author_user_id = auth.uid() then
    raise exception 'You cannot report your own message';
  end if;

  insert into public.message_reports
    (message_id, season_id, reporter_user_id, reported_user_id, reported_name, message_body, reason, details)
  values
    (v_msg.id, v_msg.season_id, auth.uid(), v_msg.author_user_id, v_msg.author_name, v_msg.body, p_reason, v_details)
  on conflict (message_id, reporter_user_id) do nothing
  returning id into v_id;

  -- Reporting the same message twice is fine; it just doesn't add a second row.
  if v_id is null then
    select id into v_id from public.message_reports
     where message_id = v_msg.id and reporter_user_id = auth.uid();
  end if;
  return v_id;
end;
$$;

revoke all on function public.report_season_message(uuid, text, text) from public, anon;
grant execute on function public.report_season_message(uuid, text, text) to authenticated;

-- ---- Pushes respect blocks ---------------------------------------------------
-- Same function as 20261006150000_chat_push_targets.sql with one extra
-- condition: nobody who has blocked the sender is sent a push for their message.
create or replace function public.season_chat_push_targets(p_season_id uuid)
returns table (team_name text, user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_access_season(p_season_id) then
    raise exception 'Not authorized';
  end if;

  return query
  with s as (
    select se.id, se.account_id, se.team_id,
           coalesce(nullif(btrim(se.team_name), ''), se.name) as label
    from public.seasons se
    where se.id = p_season_id
  ),
  people as (
    select m.user_id as uid
      from public.memberships m join s on m.account_id = s.account_id
     where m.role in ('owner', 'admin', 'coach')
    union
    select tm.user_id
      from public.team_managers tm join s on tm.team_id = s.team_id
     where tm.user_id is not null
    union
    select a.guardian_user_id
      from public.season_roster sr join public.athletes a on a.id = sr.athlete_id
     where sr.season_id = p_season_id and a.guardian_user_id is not null
    union
    select p.id
      from public.season_roster sr join public.profiles p on lower(p.email) = lower(sr.player_email)
     where sr.season_id = p_season_id and sr.player_email is not null
  )
  select (select label from s), pe.uid
    from people pe
   where pe.uid is not null
     and pe.uid <> auth.uid()
     and not exists (
       select 1 from public.user_blocks b
        where b.blocker_user_id = pe.uid and b.blocked_user_id = auth.uid()
     );
end;
$$;

revoke all on function public.season_chat_push_targets(uuid) from public, anon;
grant execute on function public.season_chat_push_targets(uuid) to authenticated;
