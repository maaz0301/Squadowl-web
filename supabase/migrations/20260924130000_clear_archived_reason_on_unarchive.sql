-- Keep archived_reason honest when a row comes back to life by any route.
--
-- 20260924120000_archive_on_plan_downgrade.sql made `archived_reason` the thing
-- that separates a restorable archive ('plan_downgrade' / 'user') from a delete
-- (archived = true, reason null — deleteTeam() only sets archived). The apps'
-- restore paths clear the reason themselves, but other writers un-archive
-- without knowing about it — the founder console's setTeamArchived() and
-- unarchive-tryout/season writes only flip `archived`.
--
-- That leaves a live row carrying a stale reason. Delete it later and it is
-- archived *with* a reason, so it is offered back on the Archived page even
-- though the user deleted it. Clearing the reason whenever `archived` stops
-- being true makes "live row => no reason" an invariant no matter who writes,
-- and needs no client change (or column) on instances that lack the column.

create or replace function public.clear_archived_reason_on_unarchive()
returns trigger
language plpgsql
as $$
begin
  new.archived_reason := null;
  return new;
end;
$$;

drop trigger if exists teams_clear_archived_reason on public.teams;
create trigger teams_clear_archived_reason
  before update of archived on public.teams
  for each row
  when (new.archived is not true and new.archived_reason is not null)
  execute function public.clear_archived_reason_on_unarchive();

drop trigger if exists seasons_clear_archived_reason on public.seasons;
create trigger seasons_clear_archived_reason
  before update of archived on public.seasons
  for each row
  when (new.archived is not true and new.archived_reason is not null)
  execute function public.clear_archived_reason_on_unarchive();

drop trigger if exists tryouts_clear_archived_reason on public.tryouts;
create trigger tryouts_clear_archived_reason
  before update of archived on public.tryouts
  for each row
  when (new.archived is not true and new.archived_reason is not null)
  execute function public.clear_archived_reason_on_unarchive();

-- Rows already in the bad state (un-archived by a writer that left the reason).
-- The triggers above do the clearing, so this just touches `archived`.
update public.teams    set archived = archived where archived is not true and archived_reason is not null;
update public.seasons  set archived = archived where archived is not true and archived_reason is not null;
update public.tryouts  set archived = archived where archived is not true and archived_reason is not null;
