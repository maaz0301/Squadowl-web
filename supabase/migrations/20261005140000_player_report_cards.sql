-- Player report cards.
--
-- A coach builds one for a player to go through with the family: which of the
-- player's evaluations to include, the coach's own comments, optional AI
-- comments, and any files, videos or links worth showing. Scores are not
-- stored; they are worked out from the chosen evaluations when the card is
-- opened, so a card can never disagree with the evaluations it points at.
--
-- Staff only: whoever can manage the evaluation (account owner/admin/coach, or
-- the team's delegated manager), or staff of the player's account. Uploads sit
-- in a private bucket reached through signed URLs.

create table if not exists public.player_report_cards (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  tryout_id     uuid references public.tryouts(id) on delete set null,
  title         text not null default 'Player Report Card' check (char_length(title) <= 200),
  -- Evaluation (evals.id) rows the card includes. Empty means none selected.
  eval_ids      jsonb not null default '[]'::jsonb,
  coach_comments text not null default '' check (char_length(coach_comments) <= 10000),
  ai_comments   text not null default '' check (char_length(ai_comments) <= 10000),
  -- [{ kind: 'file'|'video'|'link', name, path?, url?, size?, contentType? }]
  attachments   jsonb not null default '[]'::jsonb,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_player_report_cards_athlete on public.player_report_cards(athlete_id, created_at desc);
create index if not exists idx_player_report_cards_tryout on public.player_report_cards(tryout_id);

alter table public.player_report_cards enable row level security;

create or replace function public.can_manage_report_card(t uuid, acct uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_account_role(acct, array['owner','admin','coach']::membership_role[])
      or (t is not null and public.can_manage_tryout(t));
$$;
grant execute on function public.can_manage_report_card(uuid, uuid) to authenticated;

drop policy if exists report_cards_rw on public.player_report_cards;
create policy report_cards_rw on public.player_report_cards
  for all using (public.can_manage_report_card(tryout_id, account_id))
  with check (public.can_manage_report_card(tryout_id, account_id));

create or replace function public.player_report_cards_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.account_id := old.account_id;
    new.athlete_id := old.athlete_id;
  end if;
  return new;
end;
$$;
drop trigger if exists player_report_cards_touch on public.player_report_cards;
create trigger player_report_cards_touch before insert or update on public.player_report_cards
  for each row execute function public.player_report_cards_touch();

-- Keys are `<account id>/<upload id>/<filename>`; staff of that account write
-- and read. Attachments reach a card only through its row, which is staff-only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('report-card-files', 'report-card-files', false, 52428800)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists report_card_files_insert on storage.objects;
create policy report_card_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-card-files'
              and public.has_account_role(((storage.foldername(name))[1])::uuid,
                                          array['owner','admin','coach']::membership_role[]));

drop policy if exists report_card_files_read on storage.objects;
create policy report_card_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'report-card-files'
         and public.has_account_role(((storage.foldername(name))[1])::uuid,
                                     array['owner','admin','coach']::membership_role[]));

drop policy if exists report_card_files_delete on storage.objects;
create policy report_card_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'report-card-files'
         and public.has_account_role(((storage.foldername(name))[1])::uuid,
                                     array['owner','admin','coach']::membership_role[]));
