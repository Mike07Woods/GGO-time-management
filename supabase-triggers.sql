-- ============================================================================
-- GGO Time Management — Auth trigger
-- Automatically creates a profiles row whenever a new user signs up.
--
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- It is self-contained and safe to re-run (CREATE OR REPLACE + DROP IF EXISTS).
-- NOTE: this assumes the public.profiles table already exists
--       (created by supabase-schema.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Function: runs on each new auth.users insert and creates the matching profile.
--   - role defaults to 'user'
--   - email is pulled from the new auth.users record
--   - first/last name are read from sign-up metadata when provided
-- SECURITY DEFINER lets the function insert into public.profiles regardless of
-- the row level security policies on that table.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, role)
  values (
    new.id,                                                 -- same id as auth.users
    new.email,                                              -- email pulled from auth.users
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),  -- optional, from sign-up metadata
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),   -- optional, from sign-up metadata
    'user'                                                  -- default role
  )
  on conflict (id) do nothing;  -- don't error if a profile already exists

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Trigger: fire the function AFTER each insert into auth.users.
-- Dropped first so this file can be re-run without "already exists" errors.
-- ----------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================================
-- DONE. New sign-ups will now get a profiles row with role = 'user'.
-- ============================================================================
