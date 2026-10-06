-- An organization logo, printed on exported reports next to the team's logo.
-- Stored as a public URL in the avatars bucket (organizations/<account id>.<ext>),
-- the same place team logos live. Written by owners/admins through the existing
-- accounts update policy.
alter table public.accounts
  add column if not exists logo_url text;

comment on column public.accounts.logo_url is
  'Public URL of the organization logo, printed on exported reports. Null = none.';
