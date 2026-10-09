-- Which account's storage a video for a given Library item, report card, team
-- post or evaluation belongs to. A delegated team manager works in the owning
-- club's account, not their own, so the apps cannot assume "my account".
--
-- Runs as the caller (security invoker): it answers only for things the caller
-- can already see under row level security, and returns null otherwise.
create or replace function public.video_context_account(p_context text, p_context_id uuid)
returns uuid language sql stable security invoker set search_path = public as $$
  select case p_context
    when 'library' then (select li.account_id from public.library_items li where li.id = p_context_id)
    when 'report_card' then (select rc.account_id from public.player_report_cards rc where rc.id = p_context_id)
    when 'team_post' then (
      select se.account_id from public.season_posts sp
      join public.seasons se on se.id = sp.season_id where sp.id = p_context_id)
    when 'evaluation' then (
      select ty.account_id from public.evaluations ev
      join public.tryouts ty on ty.id = ev.tryout_id where ev.id = p_context_id)
  end;
$$;
grant execute on function public.video_context_account(text, uuid) to authenticated;
revoke execute on function public.video_context_account(text, uuid) from anon;
