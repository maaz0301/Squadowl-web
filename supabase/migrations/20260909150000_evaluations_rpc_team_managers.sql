-- get_evaluations_for_tryouts(uuid[], uuid, int) — let a delegated team
-- manager read back the evaluations on their own team's assessments.
--
-- Reported by a client coach, with two windows side by side on the same
-- assessment: the club owner's roster reads "1000 players · 1000 scored" with
-- an evals badge on every card, and the delegated manager's reads "1000
-- players · 0 scored" with every card marked Unscored.
--
-- The roster is right in both, so this is not the assessor-mode gate — that
-- now resolves from Tryout.viewerIsOwner, which is true for a manager, which
-- is exactly why the Unscored badge shows at all (it is hidden in assessor
-- mode). What is empty is the evaluations read itself.
--
-- The cause is the authorization clause this function has carried since it was
-- introduced:
--
--     and exists (select 1 from public.tryouts t
--                 where t.id = e.tryout_id and has_account_access(t.account_id))
--
-- A CLUB-mode delegation is not account access. The manager holds no
-- membership on the club's account — the grant lives in `team_managers`
-- against one team — so has_account_access() is false for them and every
-- evaluation on an assessment the club created on their team is filtered out.
-- No error: the RPC succeeds and returns an empty set, which the app can only
-- read as "nobody has scored anyone yet".
--
-- Authorized after this:
--   1. staff on the account that owns the assessment — unchanged, and still
--      the whole of the check for everyone who is not a delegate;
--   2. a coach the assessment's *team* reaches — CLUB-mode delegation, or a
--      club owner whose team a delegate created the assessment under. This is
--      the new grant. Asked through the deployed
--      list_tryouts_for_managed_teams() / list_tryouts_on_my_owned_teams()
--      functions rather than by reading `team_managers`, whose shape and
--      policies live in the backend repo (same reasoning as the note on
--      soft_delete_tryout), and asked dynamically so an instance that has not
--      deployed them still gets 1 rather than a function that won't create.
--      Any error from them is read as "not this way", never as a grant.
--
-- These are the same two functions listTryouts() merges and getTryout() tags
-- __viewerManagesTeam from, so what this returns now lines up with the
-- ownership the client was already showing this person: a manager who is told
-- they own the assessment can finally read the scores on it.
--
-- NOT widened here, deliberately: a *lead* assessor also passes
-- Tryout.viewerIsOwner (assembleTryouts: `myAssessorRole === 'lead'`) and
-- would hit this same empty read on an assessment sitting on someone else's
-- account. That is the same shape of gap, but it is a different grant to a
-- different kind of person, and nobody has asked for it — add a third branch
-- against tryout_assessors if it is wanted, rather than assuming it here.
--
-- NOTE FOR REVIEW: this function is `security definer`, so the clause below is
-- the whole of the check — widening it widens what a delegate can read, and
-- the `evaluations` / `evaluation_scores` policies it is reconstructed against
-- live in the backend repo and are the source of truth. Diff it against them
-- before applying. Note also that this fixes the RPC path only: if the RPC is
-- not deployed, fetchEvaluationsForTryouts() falls through to the embedded and
-- direct reads, which go through those table policies directly and will keep
-- showing a manager zero evaluations until the policies are widened to match.
--
-- Body is otherwise the keyset-paged read from
-- 20260826000000_paginate_evaluations_rpc.sql, unchanged: same signature, same
-- jsonb shape, same `order by e.id` / `limit p_limit` paging contract.

create or replace function public.get_evaluations_for_tryouts(
  p_tryout_ids uuid[],
  p_after_id uuid default null,
  p_limit int default 1000
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed uuid[];
  v_extra uuid[];
begin
  -- 1. Staff on the account that owns the assessment.
  select coalesce(array_agg(t.id), '{}'::uuid[])
    into v_allowed
  from public.tryouts t
  where t.id = any(p_tryout_ids)
    and has_account_access(t.account_id);

  -- 2. Reached through the team. Both directions: a team delegated to the
  --    caller, and the caller's own team that a delegate created on.
  if to_regprocedure('public.list_tryouts_for_managed_teams()') is not null then
    begin
      execute 'select coalesce(array_agg(t.id), ''{}''::uuid[])
                 from public.list_tryouts_for_managed_teams() t
                where t.id = any($1)'
        into v_extra using p_tryout_ids;
      v_allowed := v_allowed || v_extra;
    exception when others then
      null;
    end;
  end if;

  if to_regprocedure('public.list_tryouts_on_my_owned_teams()') is not null then
    begin
      execute 'select coalesce(array_agg(t.id), ''{}''::uuid[])
                 from public.list_tryouts_on_my_owned_teams() t
                where t.id = any($1)'
        into v_extra using p_tryout_ids;
      v_allowed := v_allowed || v_extra;
    exception when others then
      null;
    end;
  end if;

  if v_allowed is null or cardinality(v_allowed) = 0 then
    return;
  end if;

  return query
  select to_jsonb(e) || jsonb_build_object(
    'evaluation_scores',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('rubric_key', es.rubric_key, 'value', es.value))
        from public.evaluation_scores es
        where es.evaluation_id = e.id
      ),
      '[]'::jsonb
    )
  )
  from public.evaluations e
  where e.tryout_id = any(v_allowed)
    and (p_after_id is null or e.id > p_after_id)
  order by e.id
  limit p_limit;
end;
$$;

revoke all on function public.get_evaluations_for_tryouts(uuid[], uuid, int) from public;
grant execute on function public.get_evaluations_for_tryouts(uuid[], uuid, int) to authenticated;
