-- An athlete's height in centimetres, so coaches can track growth and compare it with test results.
alter table public.athletes
  add column if not exists height_cm numeric(5,1)
  check (height_cm is null or (height_cm >= 30 and height_cm <= 260));
