-- Custom field names: an account can rename a few terms shown throughout the
-- app (Player -> Skater, Jersey # -> Skate Ontario #, Hockey -> Skating).
-- Stored as a small JSON object, e.g. {"player":"Skater","jersey":"Skate Ontario #","sport":"Skating"};
-- an empty object (the default) means every term keeps its standard name.
-- Written through the existing accounts_update policy (owner/admin only) and
-- read by every member of the account via accounts_read.
alter table public.accounts
  add column if not exists custom_labels jsonb not null default '{}'::jsonb;
