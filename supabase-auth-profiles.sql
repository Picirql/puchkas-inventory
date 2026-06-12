-- Run this once in the Supabase SQL Editor to switch the app over to
-- Supabase Auth (email/password) from the old PIN system.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null,
  role text not null check (role in ('manager','warehouse','shop1','shop2','shop3','shop4','kitchen')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Any signed-in user can read/write the profiles table. This matches the
-- existing "anon full access" trust model used by the other tables, just
-- scoped to authenticated users -- it's what lets a logged-in manager
-- insert a profiles row for a newly created account.
create policy "authenticated manage profiles" on profiles
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Before creating your first account, go to:
--   Authentication -> Providers -> Email -> turn OFF "Confirm email"
-- so new accounts can log in immediately without clicking an email link.

-- To create your own (manager) account:
-- 1. Authentication -> Users -> Add user -> enter your email + a password,
--    and tick "Auto Confirm User".
-- 2. Copy the new user's UUID from the Users list.
-- 3. Run:
--      insert into profiles (id, email, username, role)
--      values ('<paste-uuid-here>', '<your-email>', '<your-username>', 'manager');
-- 4. Log in to the app with that email/password.

-- ===================== Migration (already-created profiles table) =====================
-- If you already ran this script before the `username` column existed (i.e. you
-- already created your own account and the `profiles` table is in place), just
-- add the new column and backfill your own row:
--
--   alter table profiles add column if not exists username text;
--
--   update profiles set username = '<your-username>' where email = '<your-email>';
--
--   alter table profiles alter column username set not null;
