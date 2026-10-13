-- Tag a Library item (usually a video) with the player it is about, so it also
-- shows on that player's report card screen.
--
-- The tag is only a pointer. Who can see the item is still decided by the
-- Library's audience toggles, so tagging never widens access. The player must
-- belong to the item's account, directly or through a granted share, so a tag
-- cannot reach into another account's athletes.

alter table public.library_items
  add column if not exists athlete_id uuid references public.athletes(id) on delete set null;

create index if not exists idx_library_items_athlete
  on public.library_items(athlete_id) where athlete_id is not null;

create or replace function public.library_items_check_athlete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.athlete_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.athlete_id is not distinct from old.athlete_id then
    return new;
  end if;
  if not exists (
    select 1 from public.athletes a
    where a.id = new.athlete_id
      and (
        a.account_id = new.account_id
        or exists (
          select 1 from public.athlete_account_access g
          where g.athlete_id = a.id and g.account_id = new.account_id
        )
      )
  ) then
    raise exception 'That player is not on this account' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists library_items_check_athlete on public.library_items;
create trigger library_items_check_athlete
  before insert or update of athlete_id on public.library_items
  for each row execute function public.library_items_check_athlete();
