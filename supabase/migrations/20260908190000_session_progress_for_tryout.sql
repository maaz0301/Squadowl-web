-- get_session_progress_for_tryout(uuid) — how far along each player is, for
-- someone who cannot read the evaluations themselves.
--
-- Reported by a client coach: an assessor scoring a player who already had
-- Sessions 1-5 from the coach was offered "Session 1" and saved a sixth
-- evaluation under it, instead of continuing at Session 6.
--
-- The rinkside screen picks the next session as "highest session this player
-- already has + 1", read off the assessment's own evaluations. Those never
-- reach an assessor: get_evaluations_for_tryouts() only returns rows where
-- has_account_access(t.account_id) holds, and an assessor reaches a tryout
-- through a tryout_assessors row, not a membership — so the RPC returns zero
-- rows, the client reads that as "no evaluations yet", and numbering restarts.
--
-- Widening that function was the other option and was deliberately not taken:
-- an assessor would then read every other evaluator's scores and
-- recommendations before entering their own, which is both the coach's to see
-- (the Results tab is coach-only for this reason) and a way to bias a blind
-- assessment. This returns session *numbers* and nothing else — no scores, no
-- recommendations, no evaluator names.
--
-- Authorized: an assessor invited to this assessment (any role, as long as
-- they haven't declined), and staff on the account that owns it. Everyone else
-- gets an empty result rather than an error — the caller is a numbering hint,
-- and a coach whose own evaluations are already loaded does not call it.
--
-- NOTE FOR REVIEW: the membership check mirrors soft_delete_tryout() rather
-- than the `evaluations` policies, which live in the backend repo and are the
-- source of truth. Diff it against them before applying. Sessions are stored
-- as the label text ('Session 3'); rows whose session doesn't match that shape
-- (null, or a free-text label like 'Extra View') are ignored, exactly as the
-- client's own parsing ignores them.

create or replace function public.get_session_progress_for_tryout(p_tryout_id uuid)
returns table (participant_id uuid, max_session int)
language sql
stable
security definer
set search_path = public
as $$
  select e.participant_id,
         max((substring(e.session from '^Session ([0-9]+)$'))::int) as max_session
  from public.evaluations e
  where e.tryout_id = p_tryout_id
    and e.session ~ '^Session [0-9]+$'
    and (
      exists (
        select 1
        from public.tryout_assessors a
        where a.tryout_id = p_tryout_id
          and a.user_id = auth.uid()
          and coalesce(a.status, 'accepted') <> 'declined'
      )
      or exists (
        select 1
        from public.tryouts t
        join public.memberships m on m.account_id = t.account_id
        where t.id = p_tryout_id
          and m.user_id = auth.uid()
          and m.role in ('owner', 'admin', 'coach')
      )
    )
  group by e.participant_id;
$$;

revoke all on function public.get_session_progress_for_tryout(uuid) from public;
grant execute on function public.get_session_progress_for_tryout(uuid) to authenticated;
