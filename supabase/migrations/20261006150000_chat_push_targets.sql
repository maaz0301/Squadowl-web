-- Who gets a phone push when someone posts in a team's chat.
--
-- Everyone who can open the chat except the sender: staff on the account that
-- owns the team (owner, admin, coach), the team's managers, the guardian of each
-- athlete on the roster, and players whose own address is on the roster. The app
-- calls this after a message is sent, then pushes to the ids it returns.

create or replace function public.season_chat_push_targets(p_season_id uuid)
returns table (team_name text, user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_access_season(p_season_id) then
    raise exception 'Not authorized';
  end if;

  return query
  with s as (
    select se.id, se.account_id, se.team_id,
           coalesce(nullif(btrim(se.team_name), ''), se.name) as label
    from public.seasons se
    where se.id = p_season_id
  ),
  people as (
    select m.user_id as uid
      from public.memberships m join s on m.account_id = s.account_id
     where m.role in ('owner', 'admin', 'coach')
    union
    select tm.user_id
      from public.team_managers tm join s on tm.team_id = s.team_id
     where tm.user_id is not null
    union
    select a.guardian_user_id
      from public.season_roster sr join public.athletes a on a.id = sr.athlete_id
     where sr.season_id = p_season_id and a.guardian_user_id is not null
    union
    select p.id
      from public.season_roster sr join public.profiles p on lower(p.email) = lower(sr.player_email)
     where sr.season_id = p_season_id and sr.player_email is not null
  )
  select (select label from s), pe.uid
    from people pe
   where pe.uid is not null and pe.uid <> auth.uid();
end;
$$;

revoke all on function public.season_chat_push_targets(uuid) from public, anon;
grant execute on function public.season_chat_push_targets(uuid) to authenticated;
