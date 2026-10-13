-- Discount codes for the video storage add-on.
--
-- A code is tied to video storage by listing 'video_storage' among its plan
-- tiers. The reverse also holds: a code with no tiers ("every paid plan") keeps
-- applying to plan upgrades only, so no existing code starts discounting storage.
-- The founder console saves the tier; check_discount_code enforces it.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.founder_save_discount_code(uuid,text,text,text,numeric,int,text,int,int,int,text[],timestamptz,boolean)'::regprocedure);
  d := replace(d, 'array[''coach'', ''coach_plus'', ''club'']::text[]', 'array[''coach'', ''coach_plus'', ''club'', ''video_storage'']::text[]');
  d := replace(d, 'Plan tiers must be coach, coach_plus or club', 'Plan tiers must be coach, coach_plus, club or video_storage');
  execute d;
end $$;

create or replace function public.check_discount_code(p_code text, p_plan_tier text, p_account_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  d public.discount_codes;
  v_uses int;
  v_account_uses int;
begin
  select * into d from public.discount_codes where code = upper(trim(coalesce(p_code, '')));
  if not found or not d.active then
    return json_build_object('valid', false, 'message', 'That discount code isn''t valid.');
  end if;
  if d.expires_at is not null and d.expires_at <= now() then
    return json_build_object('valid', false, 'message', 'That discount code has expired.');
  end if;
  if d.plan_tiers is not null and not (coalesce(p_plan_tier, '') = any(d.plan_tiers)) then
    return json_build_object('valid', false, 'message', 'That discount code doesn''t apply to this purchase.');
  end if;
  -- Storage only takes codes made for it.
  if p_plan_tier = 'video_storage' and d.plan_tiers is null then
    return json_build_object('valid', false, 'message', 'That discount code doesn''t apply to video storage.');
  end if;

  select count(*), count(*) filter (where account_id = p_account_id)
    into v_uses, v_account_uses
    from public.discount_code_redemptions
   where code_id = d.id;

  if d.max_uses is not null and v_uses >= d.max_uses then
    return json_build_object('valid', false, 'message', 'That discount code has been fully redeemed.');
  end if;
  if d.max_uses_per_account is not null and p_account_id is not null and v_account_uses >= d.max_uses_per_account then
    return json_build_object('valid', false, 'message', 'Your organization has already used that discount code.');
  end if;

  return json_build_object(
    'valid', true,
    'id', d.id,
    'code', d.code,
    'kind', d.kind,
    'percentOff', d.percent_off,
    'amountOffCents', d.amount_off_cents,
    'duration', d.duration,
    'durationMonths', d.duration_months,
    'planTiers', d.plan_tiers);
end;
$$;
revoke all on function public.check_discount_code(text, text, uuid) from public, anon, authenticated;
