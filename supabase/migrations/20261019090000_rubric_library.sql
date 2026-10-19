-- Rubrics Library: rubrics a coach builds once and reuses across teams and evaluations.
--
-- Account-scoped, like the athletes: nothing here is shared between subscribers.
-- Staff (owner, admin, coach) of the account can read and change it. A rubric
-- added to an evaluation is copied into that evaluation's own settings with the
-- same name, so results for the same rubric line up across teams in the reports.

create table if not exists public.rubric_library (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  -- Optional sport tag (Hockey, Figure Skating, ...), searchable.
  sport        text check (sport is null or char_length(sport) <= 60),
  -- skill, time, distance, speed, quantity, ... (see SCORING_TYPES); searchable.
  scoring_type text not null default 'skill' check (char_length(scoring_type) <= 40),
  -- The rubric's definition (scale, unit, range, ranking direction, weight, category, benchmark).
  definition   jsonb not null default '{}'::jsonb,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_rubric_library_account on public.rubric_library(account_id, created_at desc);

drop trigger if exists set_rubric_library_updated_at on public.rubric_library;
create trigger set_rubric_library_updated_at
  before update on public.rubric_library
  for each row execute function public.set_updated_at();

alter table public.rubric_library enable row level security;

drop policy if exists rubric_library_read on public.rubric_library;
create policy rubric_library_read on public.rubric_library
  for select using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));

drop policy if exists rubric_library_write on public.rubric_library;
create policy rubric_library_write on public.rubric_library
  for all using (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]))
  with check (public.has_account_role(account_id, array['owner','admin','coach']::membership_role[]));
