-- Every season needs a schedule_share_token: it is the secret in the URL of the
-- season calendar feed (season-calendar-feed). Seasons created before the app
-- generated one client-side may have none, so backfill them and make the
-- database generate one for any insert that omits it.
update public.seasons
   set schedule_share_token = 'sched_' || substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 16)
 where schedule_share_token is null;

alter table public.seasons
  alter column schedule_share_token
  set default ('sched_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16));
