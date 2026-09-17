-- Founder console: Support & Content.
--
--   support_tickets / support_messages  a lightweight support inbox. Replies go
--       out from support@tryouthq.ca through the founder-support edge function,
--       with Reply-To support@, so a customer's answer lands in the real
--       mailbox; the founder logs it here as an inbound message. (Nothing reads
--       the mailbox automatically — SendGrid Inbound Parse could insert inbound
--       rows later without any change to these tables.)
--   platform_announcements  a message shown as a banner to every signed-in
--       user while it is live, optionally also emailed to every organization's
--       owners and admins (again through founder-support).
--
-- The email log has no table: it is read live from SendGrid's Email Activity
-- API by founder-support.
--
-- Same gate as the rest of the console: is_founder(). Reads go through RLS;
-- every write is a founder_* SECURITY DEFINER function or the service-role
-- edge function, so nothing here is writable by a normal session.

-- ---------------------------------------------------------------------------
-- Audit log: new action kinds (adds to 20260916130000_founder_user_management.sql)
-- ---------------------------------------------------------------------------

alter table public.founder_audit_log
  drop constraint if exists founder_audit_log_action_check;

alter table public.founder_audit_log
  add constraint founder_audit_log_action_check
  check (action in (
    'suspend', 'reactivate', 'create_org', 'update_access',
    'impersonate_start', 'impersonate_end',
    'update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user',
    'create_announcement', 'end_announcement', 'broadcast_email'
  ));

-- ---------------------------------------------------------------------------
-- Support inbox
-- ---------------------------------------------------------------------------

create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (email = lower(email)),
  -- Filled in when the address belongs to a user; the ticket outlives them.
  user_id    uuid references auth.users(id) on delete set null,
  subject    text not null,
  status     text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_updated_idx
  on public.support_tickets (status, updated_at desc);

create table if not exists public.support_messages (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references public.support_tickets(id) on delete cascade,
  direction      text not null check (direction in ('inbound', 'outbound')),
  body           text not null,
  author_email   text,
  -- Set when SendGrid refused an outbound reply; the message is kept so the
  -- founder can see what didn't go out.
  delivery_error text,
  created_at     timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists support_tickets_founder_read on public.support_tickets;
create policy support_tickets_founder_read on public.support_tickets
  for select using (public.is_founder());

drop policy if exists support_messages_founder_read on public.support_messages;
create policy support_messages_founder_read on public.support_messages
  for select using (public.is_founder());

-- Log an email the customer sent to support@ as a new ticket.
create or replace function public.founder_create_support_ticket(
  p_email text,
  p_subject text,
  p_body text
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ticket uuid;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required' using errcode = '22023';
  end if;
  if trim(coalesce(p_subject, '')) = '' or trim(coalesce(p_body, '')) = '' then
    raise exception 'Subject and message are required' using errcode = '22023';
  end if;

  insert into public.support_tickets (email, user_id, subject)
  values (v_email, (select p.id from public.profiles p where lower(p.email) = v_email limit 1), trim(p_subject))
  returning id into v_ticket;

  insert into public.support_messages (ticket_id, direction, body, author_email)
  values (v_ticket, 'inbound', trim(p_body), v_email);

  return v_ticket;
end;
$$;

grant execute on function public.founder_create_support_ticket(text, text, text) to authenticated;

-- Log the customer's reply on an existing ticket. A reply reopens it.
create or replace function public.founder_add_support_message(
  p_ticket_id uuid,
  p_body text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if trim(coalesce(p_body, '')) = '' then
    raise exception 'Message is required' using errcode = '22023';
  end if;

  update public.support_tickets
     set status = 'open', updated_at = now()
   where id = p_ticket_id
  returning email into v_email;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  insert into public.support_messages (ticket_id, direction, body, author_email)
  values (p_ticket_id, 'inbound', trim(p_body), v_email);
end;
$$;

grant execute on function public.founder_add_support_message(uuid, text) to authenticated;

create or replace function public.founder_set_support_ticket_status(
  p_ticket_id uuid,
  p_status text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status not in ('open', 'resolved') then
    raise exception 'Status must be open or resolved' using errcode = '22023';
  end if;

  update public.support_tickets set status = p_status, updated_at = now() where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.founder_set_support_ticket_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table if not exists public.platform_announcements (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  message               text not null,
  severity              text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  starts_at             timestamptz not null default now(),
  -- Null runs until the founder ends it.
  ends_at               timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  emailed_at            timestamptz,
  email_recipient_count int
);

create index if not exists platform_announcements_created_idx
  on public.platform_announcements (created_at desc);

alter table public.platform_announcements enable row level security;

-- Every signed-in user sees what is live now; the founder sees the history.
drop policy if exists platform_announcements_read on public.platform_announcements;
create policy platform_announcements_read on public.platform_announcements
  for select to authenticated using (
    public.is_founder()
    or (starts_at <= now() and (ends_at is null or ends_at > now()))
  );

create or replace function public.founder_create_announcement(
  p_title text,
  p_message text,
  p_severity text default 'info',
  p_ends_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if trim(coalesce(p_title, '')) = '' or trim(coalesce(p_message, '')) = '' then
    raise exception 'Title and message are required' using errcode = '22023';
  end if;
  if p_severity not in ('info', 'warning', 'critical') then
    raise exception 'Severity must be info, warning or critical' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'The end time must be in the future' using errcode = '22023';
  end if;

  insert into public.platform_announcements (title, message, severity, ends_at, created_by)
  values (trim(p_title), trim(p_message), p_severity, p_ends_at, auth.uid())
  returning id into v_id;

  perform public.founder_write_audit(
    'create_announcement', null, trim(p_title), null,
    jsonb_build_object('announcement_id', v_id, 'severity', p_severity, 'ends_at', p_ends_at));

  return v_id;
end;
$$;

grant execute on function public.founder_create_announcement(text, text, text, timestamptz) to authenticated;

create or replace function public.founder_end_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.platform_announcements
     set ends_at = now()
   where id = p_id and (ends_at is null or ends_at > now())
  returning title into v_title;
  if not found then
    raise exception 'Announcement not found or already ended' using errcode = 'P0002';
  end if;

  perform public.founder_write_audit('end_announcement', null, v_title, null,
    jsonb_build_object('announcement_id', p_id));
end;
$$;

grant execute on function public.founder_end_announcement(uuid) to authenticated;

-- Who a broadcast email goes to: owners and admins of every account that isn't
-- suspended, one row per address. Service role only — it is called by
-- founder-support after that function has checked the caller is the founder.
create or replace function public.founder_announcement_recipients()
returns table (email text) language sql stable security definer set search_path = public as $$
  select distinct lower(p.email)
    from public.memberships m
    join public.accounts a on a.id = m.account_id
    join public.profiles p on p.id = m.user_id
   where m.role in ('owner', 'admin')
     and p.email is not null
     and public.account_access_status(a) <> 'suspended';
$$;

revoke all on function public.founder_announcement_recipients() from public, anon, authenticated;
grant execute on function public.founder_announcement_recipients() to service_role;
