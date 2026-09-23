-- Archive what a lower plan no longer covers, instead of leaving it live.
--
-- When an account's plan_tier drops (a cancellation that reaches period end, a
-- scheduled downgrade taking effect, or a tier edit made by hand), every team
-- and evaluation beyond what the new tier includes is archived. The oldest
-- ones — the first team and the first evaluation — stay active, so the account
-- is never left empty. Nothing is deleted: the coach restores the archived
-- ones from "Archived teams" / "Archived evaluations" once the plan has room
-- for them again (the apps refuse a restore that would go over the limit).
--
-- The limits below mirror src/data/plans.ts (and the mobile app's copy):
--
--   tier        teams              evaluations
--   free        1                  1
--   coach       1                  unlimited
--   coach_plus  2                  unlimited
--   club        6 + extra licenses unlimited
--
-- Done as a trigger on accounts, not in the Stripe webhook, because plan_tier is
-- written from more than one place (stripe-webhook in the functions repo, the
-- founder console) and both apps read the same rows: one rule here covers all
-- of them. Upgrades, and tiers outside the four above (the retired 'pro' /
-- 'association' enum values), are left alone.

-- ---------------------------------------------------------------------------
-- Why a row is archived
-- ---------------------------------------------------------------------------

-- Archived teams double as deleted teams (deleteTeam() only sets archived =
-- true), so "archived" alone can't tell a team that should be offered back —
-- one the plan retired, or one the coach archived on purpose — from one the
-- coach deleted, which must stay gone. The reason column is that distinction:
-- 'plan_downgrade' or 'user' means restorable, null means deleted.
alter table public.teams    add column if not exists archived_reason text;
alter table public.seasons  add column if not exists archived_reason text;
alter table public.tryouts  add column if not exists archived_reason text;

comment on column public.teams.archived_reason is
  'Why the team is archived and restorable: plan_downgrade (a plan drop retired it) or user (the coach archived it). Null when archived (deleted) by the user, which stays gone.';
comment on column public.seasons.archived_reason is
  'Set (plan_downgrade or user) when the season was archived along with its team; restored with that team. Null for a season archived on its own.';
comment on column public.tryouts.archived_reason is
  'Set to plan_downgrade when the evaluation was archived by a plan downgrade; null when the user archived it.';

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

create or replace function public.plan_tier_rank(p_tier text)
returns int language sql immutable as $$
  select case p_tier
    when 'free' then 0
    when 'coach' then 1
    when 'coach_plus' then 2
    when 'club' then 3
  end;
$$;

create or replace function public.archive_over_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_rank int := public.plan_tier_rank(old.plan_tier::text);
  v_new_rank int := public.plan_tier_rank(new.plan_tier::text);
  v_team_limit int;
  v_eval_limit int;
begin
  -- Only a move down between two known tiers.
  if v_old_rank is null or v_new_rank is null or v_new_rank >= v_old_rank then
    return new;
  end if;

  v_team_limit := case new.plan_tier::text
    when 'free' then 1
    when 'coach' then 1
    when 'coach_plus' then 2
    else 6 + coalesce(new.extra_team_licenses, 0)
  end;
  -- Free is the only tier that caps evaluations.
  v_eval_limit := case new.plan_tier::text when 'free' then 1 else null end;

  -- Teams: keep the oldest v_team_limit, archive the rest and their seasons.
  -- Delegated teams (a club's team managed by someone else's account) belong to
  -- the club's account, not this one, so they are never touched here.
  with retired as (
    update public.teams
       set archived = true,
           archived_reason = 'plan_downgrade',
           updated_at = now()
     where account_id = new.id
       and archived = false
       and id not in (
         select id from public.teams
          where account_id = new.id and archived = false
          order by created_at, id
          limit v_team_limit
       )
    returning id
  )
  update public.seasons
     set archived = true,
         archived_reason = 'plan_downgrade'
   where archived = false
     and team_id in (select id from retired);

  -- Evaluations: keep the oldest v_eval_limit live ones.
  if v_eval_limit is not null then
    update public.tryouts
       set archived = true,
           archived_reason = 'plan_downgrade',
           updated_at = now()
     where account_id = new.id
       and archived = false
       and deleted_at is null
       and id not in (
         select id from public.tryouts
          where account_id = new.id and archived = false and deleted_at is null
          order by created_at, id
          limit v_eval_limit
       );
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_archive_over_plan_limits on public.accounts;
create trigger accounts_archive_over_plan_limits
  after update of plan_tier on public.accounts
  for each row
  when (old.plan_tier is distinct from new.plan_tier)
  execute function public.archive_over_plan_limits();

-- Only the trigger should run this.
revoke all on function public.archive_over_plan_limits() from public, anon, authenticated;
