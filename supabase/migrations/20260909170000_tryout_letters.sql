-- Player selection letters: the offer / roster-decision letters a coach sends
-- once a tryout is decided, and the copy of each one attached to the player.
--
-- Requested by a client coach: "the coach can create a letter from the
-- template, save it and then select player for each type of letter. The letter
-- is sent and a copy is attached to the player card and can be re-sent, edited,
-- deleted as required."
--
-- Two tables, because those are two different lifetimes:
--
--   `letter_templates` is the wording, authored once and reused. It hangs off
--   the *account*, not one tryout — a club sends the same offer letter every
--   September, and scoping it to a tryout would mean re-typing it each season.
--   `tryout_id` is kept only as "where this was first written", for ordering a
--   coach's own list; it is not part of any access check.
--
--   `player_letters` is a *snapshot* of what one family actually received:
--   subject and body are stored already rendered, not as a reference back to
--   the template. Editing a template next season must not silently rewrite
--   history on letters that are already in someone's inbox. Editing the copy
--   here and re-sending it does update the row, which is the coach correcting a
--   letter they already sent — the flow the request asks for.
--
-- NOTE FOR REVIEW: the membership / lead-assessor checks below are
-- reconstructed from how ctx() resolves an account in SupabaseDataSource.ts and
-- from soft_delete_tryout() in this repo, not copied from the `tryouts` or
-- `accounts` policies, which live in the backend repo and are the source of
-- truth. Diff before applying, and confirm `tryouts.account_id`,
-- `tryout_participants.athlete_id` and the `memberships` role values still
-- match.

-- ---------------------------------------------------------------------------
-- Who may write letters for an assessment
-- ---------------------------------------------------------------------------

-- Deliberately narrower than athlete_is_reachable(): that one admits an invited
-- assessor, because an assessor legitimately edits the players they are
-- scoring. Mailing a family that their child did not make the team is not a
-- scoring action — it is the coach's, so this stops one case short of the
-- three `viewerIsOwner` recognizes on the client (assembleTryouts() in
-- SupabaseDataSource.ts): own-account staff, the lead assessor, and a
-- CLUB-mode delegate reaching the assessment through its team. All three are
-- "the coach" here; leaving the third out would let a delegated team manager
-- open the Letters screen (viewerIsOwner already says yes for them) and then
-- get a 42501 trying to save or send — the same shape of bug
-- soft_delete_tryout()'s own note describes, and this function copies its
-- fix: the two managed-team RPCs, called dynamically so an instance that
-- hasn't deployed them yet still gets checks 1 and 2 instead of a function
-- that won't create.
create or replace function public.tryout_letters_writable(p_tryout_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_allowed boolean := false;
begin
  select t.account_id into v_account_id
  from public.tryouts t
  where t.id = p_tryout_id;

  if v_account_id is null then
    return false;
  end if;

  -- 1. Staff on the account the assessment belongs to.
  select exists (
    select 1 from public.memberships m
    where m.account_id = v_account_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'coach')
  ) into v_allowed;

  -- 2. Its lead assessor — createTryout() seeds the creator's own row as
  --    'lead', which keeps a coach running an assessment on a club's account in
  --    charge of it.
  if not v_allowed then
    select exists (
      select 1 from public.tryout_assessors a
      where a.tryout_id = p_tryout_id
        and a.user_id = auth.uid()
        and a.role = 'lead'
        and coalesce(a.status, 'accepted') <> 'declined'
    ) into v_allowed;
  end if;

  -- 3. A coach who reaches it through the team: a CLUB-mode delegate, or a
  --    club owner whose team a delegate created the assessment under (that
  --    assessment lives on the delegate's own account per createTryout(), so
  --    check 1 can't see it). Read dynamically via to_regprocedure so a
  --    pre-migration instance without these functions degrades to checks 1
  --    and 2 rather than failing to create this function at all; any error
  --    from them reads as "not this way", never as a grant.
  if not v_allowed
     and to_regprocedure('public.list_tryouts_for_managed_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_for_managed_teams() t where t.id = $1)'
        into v_allowed using p_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  if not v_allowed
     and to_regprocedure('public.list_tryouts_on_my_owned_teams()') is not null then
    begin
      execute 'select exists (select 1 from public.list_tryouts_on_my_owned_teams() t where t.id = $1)'
        into v_allowed using p_tryout_id;
    exception when others then
      v_allowed := false;
    end;
  end if;

  return v_allowed;
end;
$$;

comment on function public.tryout_letters_writable(uuid) is
  'True when the caller may author, send and delete selection letters for this assessment: account staff, its lead assessor, or a team manager delegated the assessment''s team.';

revoke all on function public.tryout_letters_writable(uuid) from public;
grant execute on function public.tryout_letters_writable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table if not exists public.letter_templates (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name       text not null,
  -- 'offer' (made the team), 'decision' (did not), 'custom' (anything else).
  -- Mirrors LETTER_KINDS in src/data/letters.ts; a check rather than an enum so
  -- adding a kind is a one-line migration instead of a type alteration.
  kind       text not null check (kind in ('offer', 'decision', 'custom')),
  subject    text not null default '',
  -- Plain text with {{snake_case}} placeholders — see letters.ts. Stored
  -- unrendered on purpose: the substitution is per player, at send time.
  body       text not null default '',
  -- Where it was first written. Not an access check; nulled rather than
  -- cascaded when that assessment goes, so deleting last year's tryout doesn't
  -- take the club's offer letter with it.
  tryout_id  uuid references public.tryouts(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists letter_templates_account_idx
  on public.letter_templates (account_id, updated_at desc);

alter table public.letter_templates enable row level security;

-- One policy for every command: a template is club stationery, and anyone who
-- may send letters on the account may equally write and retire them.
drop policy if exists letter_templates_staff on public.letter_templates;
create policy letter_templates_staff on public.letter_templates
  for all to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.account_id = letter_templates.account_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'coach')
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.account_id = letter_templates.account_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'coach')
    )
  );

-- ---------------------------------------------------------------------------
-- The copy attached to a player
-- ---------------------------------------------------------------------------

create table if not exists public.player_letters (
  id              uuid primary key default gen_random_uuid(),
  tryout_id       uuid not null references public.tryouts(id) on delete cascade,
  -- The player *in this assessment*, which is what the card the copy hangs on
  -- actually is. Cascades: a player removed from the roster has no card left to
  -- attach anything to.
  participant_id  uuid not null references public.tryout_participants(id) on delete cascade,
  -- Denormalised so a player's history can be assembled per athlete later
  -- without joining back through participants. Nullable for the same reason
  -- template_id is: the copy outlives what it points at.
  athlete_id      uuid references public.athletes(id) on delete set null,
  template_id     uuid references public.letter_templates(id) on delete set null,
  kind            text not null check (kind in ('offer', 'decision', 'custom')),
  -- Already rendered — placeholders substituted for this player. See the header.
  subject         text not null default '',
  body            text not null default '',
  recipient_email text,
  -- 'sent' once SendGrid accepted it; 'failed' when it didn't, which leaves the
  -- copy in place so the coach can fix the address and retry rather than
  -- re-authoring the letter; 'draft' for one saved without sending.
  status          text not null default 'draft' check (status in ('draft', 'sent', 'failed')),
  error           text,
  sent_at         timestamptz,
  sent_by         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The send screen's history, newest first.
create index if not exists player_letters_tryout_idx
  on public.player_letters (tryout_id, created_at desc);

-- The player card's own list.
create index if not exists player_letters_participant_idx
  on public.player_letters (participant_id, created_at desc);

alter table public.player_letters enable row level security;

-- No unique constraint on (participant_id, kind): a player can legitimately
-- receive more than one letter — an offer after a waitlist note, or a corrected
-- re-issue kept alongside the original.

drop policy if exists player_letters_staff on public.player_letters;
create policy player_letters_staff on public.player_letters
  for all to authenticated
  using (public.tryout_letters_writable(player_letters.tryout_id))
  with check (public.tryout_letters_writable(player_letters.tryout_id));

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

-- Named for this migration rather than a shared set_updated_at(): a generic one
-- may already exist in the backend repo, and `create or replace` on it from
-- here would quietly redefine whatever else uses it.
create or replace function public.letters_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists letter_templates_touch_updated_at on public.letter_templates;
create trigger letter_templates_touch_updated_at
  before update on public.letter_templates
  for each row execute function public.letters_touch_updated_at();

drop trigger if exists player_letters_touch_updated_at on public.player_letters;
create trigger player_letters_touch_updated_at
  before update on public.player_letters
  for each row execute function public.letters_touch_updated_at();
