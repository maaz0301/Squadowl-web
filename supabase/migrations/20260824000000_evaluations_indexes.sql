-- Step 1 of the evaluations 57014 fix: indexes only.
--
-- Safe to apply as-is — it changes no policy and grants no access, so it cannot
-- widen what anyone can read. Try this before the RPC in the companion
-- migration and re-test; if a missing index was the whole problem, the RPC
-- (which bypasses RLS and therefore needs careful review) is not needed at all.
--
-- Why an index matters so much here: assembleTryouts() reads evaluations with
-- evaluation_scores embedded (`select=*,evaluation_scores(rubric_key,value)`),
-- paged with OFFSET/LIMIT across a batch of tryout_ids. Without an index on
-- tryout_id, Postgres seq-scans the whole evaluations table and evaluates its
-- row-level policy on every row in it, not just the ones in the requested
-- batch — and OFFSET makes that worse on later pages, since rows already
-- skipped still have to be scanned and checked to know how many to skip.
-- Same for evaluation_scores.evaluation_id, which drives the embedded join.

create index if not exists evaluations_tryout_id_idx
  on public.evaluations (tryout_id);

create index if not exists evaluation_scores_evaluation_id_idx
  on public.evaluation_scores (evaluation_id);

analyze public.evaluations;
analyze public.evaluation_scores;
