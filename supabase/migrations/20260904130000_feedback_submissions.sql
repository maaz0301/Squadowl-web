-- Feedback submissions, their screenshot attachments, and the reviewer portal.
--
-- Before this, submitFeedback() only console.logged the survey — nothing was
-- stored, so there was nothing for a portal to show. This adds the table, the
-- private attachment bucket, and the allowlist that decides who may read other
-- people's submissions.
--
-- The reviewer gate is an *identity* allowlist, not a role. The app's roles are
-- admin/coach/assessor/guardian and every one of them is per-account: a Club
-- admin is an admin of their own club, not of the platform, so no existing role
-- expresses "may read every customer's feedback". `feedback_reviewers` holds
-- the individual email addresses that may, and it is a table rather than a
-- constant inside a function so adding or removing a reviewer is an insert or a
-- delete instead of another migration.

-- ---------------------------------------------------------------------------
-- Reviewer allowlist
-- ---------------------------------------------------------------------------

create table if not exists public.feedback_reviewers (
  -- Lowercased on the way in; the gate below compares against lower(jwt email),
  -- and a mixed-case row here would silently never match.
  email      text primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.feedback_reviewers is
  'Email addresses allowed to read every feedback submission. Deliberately not a role: the app''s roles are all per-account, and this is platform-wide access.';

alter table public.feedback_reviewers enable row level security;

-- No policies at all: the list is readable and writable only by the service
-- role and by is_feedback_reviewer() below, which is SECURITY DEFINER. A
-- reviewer has no reason to enumerate the other reviewers, and nobody may add
-- themselves to it from the client.

-- Add a reviewer:
--   insert into public.feedback_reviewers (email, note)
--   values ('someone@example.com', 'who they are')
--   on conflict (email) do nothing;
insert into public.feedback_reviewers (email, note) values
  ('raza0301301@gmail.com', 'Developer')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

-- Reads the caller's email from the JWT rather than from `profiles`, so a
-- reviewer's access can't be assumed by editing a profile row. SECURITY DEFINER
-- because the allowlist itself is unreadable to the caller.
create or replace function public.is_feedback_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.feedback_reviewers r
     where r.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

comment on function public.is_feedback_reviewer() is
  'True when the calling user''s email is on the feedback reviewer allowlist.';

grant execute on function public.is_feedback_reviewer() to authenticated;

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------

create table if not exists public.feedback_submissions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  -- Nullable: guardians sign in without a tenant account of their own, and
  -- their feedback is worth just as much as a coach's.
  account_id           uuid references public.accounts(id) on delete set null,
  -- Copied at submit time so the portal can show who wrote it without joining
  -- across to auth.users (which the portal's reader cannot select from), and so
  -- the record survives the account being deleted.
  email                text,
  display_name         text,
  overall_experience   smallint not null check (overall_experience between 1 and 5),
  ease_of_use          smallint not null check (ease_of_use between 1 and 5),
  team_hub_scheduling  smallint not null check (team_hub_scheduling between 1 and 5),
  value_for_money      smallint not null check (value_for_money between 1 and 5),
  what_is_working_well text not null default '',
  what_can_be_improved text not null default '',
  -- [{ "path": "<uid>/<submission>/<file>", "name": "shot.png", "size": 12345,
  --    "contentType": "image/png" }]. The objects themselves live in the
  --  private `feedback-attachments` bucket; `path` is the key into it, and the
  --  portal mints a short-lived signed URL per file rather than storing one.
  attachments          jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists feedback_submissions_created_idx
  on public.feedback_submissions (created_at desc);

create index if not exists feedback_submissions_user_idx
  on public.feedback_submissions (user_id, created_at desc);

alter table public.feedback_submissions enable row level security;

-- Anyone signed in may leave feedback, but only as themselves.
drop policy if exists feedback_submissions_insert on public.feedback_submissions;
create policy feedback_submissions_insert on public.feedback_submissions
  for insert with check (user_id = auth.uid());

-- You can always read your own; reviewers read everyone's.
drop policy if exists feedback_submissions_read on public.feedback_submissions;
create policy feedback_submissions_read on public.feedback_submissions
  for select using (user_id = auth.uid() or public.is_feedback_reviewer());

-- No update or delete policy on purpose: feedback is a record of what someone
-- said at a point in time, and neither the author nor a reviewer should be able
-- to quietly rewrite it.

-- ---------------------------------------------------------------------------
-- Attachment storage
-- ---------------------------------------------------------------------------

-- Private, unlike `avatars`: a screenshot of a bug is a screenshot of someone's
-- roster, so the files are reachable only through a signed URL minted for a
-- caller who already passed the policies below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  10485760, -- 10 MB; screenshots and short screen recordings, not video files
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Keys are `<user id>/<submission id>/<filename>`, so the first path segment is
-- the owner and these policies are a string comparison rather than a join.
drop policy if exists feedback_attachments_insert on storage.objects;
create policy feedback_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists feedback_attachments_read on storage.objects;
create policy feedback_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_feedback_reviewer()
    )
  );

-- Uploads happen before the submission row is inserted, so a coach who abandons
-- the form leaves orphaned objects behind. They may clear up their own.
drop policy if exists feedback_attachments_delete on storage.objects;
create policy feedback_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
