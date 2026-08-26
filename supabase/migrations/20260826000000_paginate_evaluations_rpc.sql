-- get_evaluations_for_tryouts() was called once per assembleTryouts() read and
-- whatever it returned was taken as the complete set (SupabaseDataSource.ts,
-- fetchEvaluationsForTryouts: `if (!error) return (data as Row[]) ?? [];`).
--
-- A `setof jsonb`-returning RPC is still subject to PostgREST's `db-max-rows`
-- cap, same as a plain table read — so a tryout with more evaluations than
-- that cap had the excess silently dropped, with no error, no short-page
-- signal, nothing: the RPC call just "succeeded" with a truncated result. A
-- 1000-player x 5-session dummy batch (5,000 evaluations) reads back capped
-- at whatever this project's max-rows happens to be.
--
-- Every *other* batched read in this file (fetchAllByIn, and this function's
-- own embedded/direct fallbacks) is keyset-paged by `id` for exactly this
-- reason. This adds the same shape here: an optional cursor + limit, ordered
-- by `id`, so the caller can page until a short page comes back.
--
-- The extra params change this function's signature, so `create or replace`
-- would leave the old 1-arg version standing as a separate overload rather
-- than replacing it — dropped explicitly instead, since every caller now
-- always passes all three arguments.
drop function if exists public.get_evaluations_for_tryouts(uuid[]);

create or replace function public.get_evaluations_for_tryouts(
  p_tryout_ids uuid[],
  p_after_id uuid default null,
  p_limit int default 1000
)
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
    and (p_after_id is null or e.id > p_after_id)
    and exists (
      select 1
      from public.tryouts t
      where t.id = e.tryout_id
        and has_account_access(t.account_id)
    )
  order by e.id
  limit p_limit;
$$;

revoke all on function public.get_evaluations_for_tryouts(uuid[], uuid, int) from public;
grant execute on function public.get_evaluations_for_tryouts(uuid[], uuid, int) to authenticated;
