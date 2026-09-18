-- Tracks emails whose account was self-deleted via the Profile page's
-- "Delete Account" button (supabase/functions/delete-account), so the login
-- screen can tell "you mistyped your password" apart from "this account was
-- deleted" instead of showing the same generic "Invalid login credentials"
-- for both. auth.users no longer has the row once deleteUser() runs, so
-- nothing there can answer that question after the fact — this is the only
-- record left.
--
-- No INSERT policy: the delete-account edge function writes this with the
-- service role, same reasoning as founder_audit_log.

create table if not exists public.deleted_accounts (
  email text primary key,
  deleted_at timestamptz not null default now()
);

alter table public.deleted_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- email_was_deleted: callable from the (unauthenticated) login screen, so it
-- has to reach anon. It only ever answers a yes/no about a specific email the
-- caller already typed in — no listing, no enumeration surface beyond what
-- "Invalid login credentials" already implies about whether an address was
-- ever registered.
--
-- The email is free to sign up again after a delete — Supabase doesn't block
-- reuse — and this table is never cleaned up when that happens, so the
-- exists() below also has to confirm the address isn't active again in
-- auth.users. Without that check, someone who deletes then recreates an
-- account under the same email would see "This account no longer exists" on
-- a plain mistyped password, instead of the ordinary "Invalid login
-- credentials". security definer is what gives this (and check_user_exists,
-- same pattern) read access to auth.users at all.
-- ---------------------------------------------------------------------------

create or replace function public.email_was_deleted(p_email text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deleted_accounts d
    where d.email = lower(p_email)
      and not exists (select 1 from auth.users u where lower(u.email) = lower(p_email))
  );
$$;

revoke all on function public.email_was_deleted(text) from public;
grant execute on function public.email_was_deleted(text) to anon, authenticated;
