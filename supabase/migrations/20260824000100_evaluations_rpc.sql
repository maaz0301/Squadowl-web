-- get_evaluations_for_tryouts(uuid[]) — read a batch of tryouts' evaluations
-- (with their scores) without paying the row-level policy per row.
--
-- Reading evaluations directly, with evaluation_scores embedded, makes
-- Postgres evaluate both tables' SELECT policies once per row. assembleTryouts()
-- pages that read with OFFSET/LIMIT across every tryout_id in the batch — each
-- later page has to scan and policy-check everything already skipped, so the
-- statement gets more expensive per page and eventually overruns the 8s
-- statement timeout (57014). Client-side paging does not fully fix this: the
-- policy runs on candidate rows *before* LIMIT applies, so a smaller page size
-- only pushes the crossover point further out, it doesn't remove it.
--
-- Same shape of fix as get_event_availability()/get_guardian_rosters():
-- authorize once per tryout, then return that tryout's evaluations (with their
-- scores folded in as jsonb, matching the shape the embedded PostgREST read
-- already returns) in bulk. Returning `setof jsonb` instead of `setof
-- evaluations` avoids hardcoding the evaluations column list here, so this
-- doesn't drift out of sync if that table's columns change.
--
-- APPLY 20260824000000_evaluations_indexes.sql FIRST and re-test. That one is
-- risk-free, and a missing index on tryout_id alone can cause this timeout —
-- in which case none of the below is needed.
--
-- NOTE FOR REVIEW: the authorization below is reconstructed from how the app
-- uses this data (assembleTryouts always resolves the caller's own account_id
-- via ctx() and filters tryouts by it — see listTryouts()/listTeams() in
-- SupabaseDataSource.ts), not copied from the existing evaluations/
-- evaluation_scores policies — those live in the backend repo and are the
-- source of truth. Diff the WHERE clause below against them before applying,
-- and widen or narrow to match exactly (e.g. if assessors or guardians can
-- read evaluations without full account access, this needs an additional OR
-- clause, same as get_event_availability()'s guardian branch). The point of
-- this function is to change *when* the check runs, never *what* it permits.

create or replace function public.get_evaluations_for_tryouts(p_tryout_ids uuid[])
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
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
  where e.tryout_id = any(p_tryout_ids)
    and exists (
      select 1
      from public.tryouts t
      where t.id = e.tryout_id
        and has_account_access(t.account_id)
    );
$$;

revoke all on function public.get_evaluations_for_tryouts(uuid[]) from public;
grant execute on function public.get_evaluations_for_tryouts(uuid[]) to authenticated;
