-- A phone's push token belongs to whoever is signed in on it.
--
-- The app used to add the token to the signed-in account and leave it on every
-- account that had used the phone before, so one phone ended up registered under
-- many accounts: it showed the same notification several times, and showed one
-- person's notifications to the next person to sign in. Signing in now claims the
-- token: it is removed from every other account and kept for this one.

create or replace function public.claim_fcm_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_token is null or btrim(p_token) = '' then
    return;
  end if;

  delete from public.fcm_tokens where token = p_token and user_id <> auth.uid();

  insert into public.fcm_tokens (user_id, token)
  values (auth.uid(), p_token)
  on conflict (user_id, token) do update set updated_at = now();
end;
$$;

revoke all on function public.claim_fcm_token(text) from public, anon;
grant execute on function public.claim_fcm_token(text) to authenticated;
