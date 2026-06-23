-- ============================================================================
-- GGO Time Management — Phase 1 database schema
-- Run this ENTIRE file once in the Supabase SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- It is safe to re-run: it uses IF NOT EXISTS / IF EXISTS / DROP-then-CREATE.
-- ============================================================================

-- gen_random_uuid() comes from pgcrypto (enabled by default on Supabase, but be safe).
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

-- 1) profiles — one row per user, holds their role and HR details.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  first_name  text,
  last_name   text,
  email       text,
  phone       text,
  role        text check (role in ('owner','admin','manager','user')) default 'user',
  department  text,
  position    text,
  avatar_url  text,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- 2) shifts — scheduled work blocks.
create table if not exists public.shifts (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  assigned_to uuid references public.profiles (id) on delete set null,
  start_time  timestamptz,
  end_time    timestamptz,
  location    text,
  status      text check (status in ('draft','published','cancelled')) default 'draft',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz default now()
);

-- 3) time_entries — clock in/out records with GPS + break tracking.
create table if not exists public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete cascade,
  clock_in      timestamptz,
  clock_out     timestamptz,
  clock_in_lat  decimal,
  clock_in_lng  decimal,
  clock_out_lat decimal,
  clock_out_lng decimal,
  break_start   timestamptz,
  break_end     timestamptz,
  total_hours   decimal,
  status        text check (status in ('active','on_break','completed')) default 'active',
  created_at    timestamptz default now()
);

-- 4) announcements — broadcast messages, optionally targeted at a role.
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  body        text,
  created_by  uuid references public.profiles (id) on delete set null,
  target_role text,            -- null = everyone; otherwise a role name
  created_at  timestamptz default now()
);

-- 5) announcement_reads — read receipts (one per user per announcement).
create table if not exists public.announcement_reads (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid references public.announcements (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete cascade,
  read_at         timestamptz default now(),
  unique (announcement_id, user_id)   -- prevents duplicate receipts
);

-- 6) notifications — in-app alerts per user.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete cascade,
  title       text,
  body        text,
  type        text,
  is_read     boolean default false,
  created_at  timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- INDEXES (speed up the common lookups the app performs)
-- ----------------------------------------------------------------------------
create index if not exists idx_shifts_assigned_to       on public.shifts (assigned_to);
create index if not exists idx_shifts_start_time        on public.shifts (start_time);
create index if not exists idx_time_entries_user        on public.time_entries (user_id);
create index if not exists idx_time_entries_status      on public.time_entries (status);
create index if not exists idx_notifications_user       on public.notifications (user_id);
create index if not exists idx_notifications_unread     on public.notifications (user_id, is_read);
create index if not exists idx_reads_announcement       on public.announcement_reads (announcement_id);

-- ----------------------------------------------------------------------------
-- ROLE HELPER FUNCTIONS
-- SECURITY DEFINER lets these read profiles without triggering the profiles
-- RLS policies (which would otherwise cause infinite recursion).
-- ----------------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('manager','admin','owner'),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('admin','owner'),
    false
  );
$$;

-- ----------------------------------------------------------------------------
-- AUTO-CREATE A PROFILE ON SIGN UP
-- Server-side backup to the client-side bootstrap in AuthContext.js.
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
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.shifts              enable row level security;
alter table public.time_entries        enable row level security;
alter table public.announcements       enable row level security;
alter table public.announcement_reads  enable row level security;
alter table public.notifications       enable row level security;

-- ----------------------------------------------------------------------------
-- POLICIES
-- (Dropped first so this file can be re-run without "already exists" errors.)
-- ----------------------------------------------------------------------------

-- ---- profiles --------------------------------------------------------------
drop policy if exists profiles_select        on public.profiles;
drop policy if exists profiles_insert_self   on public.profiles;
drop policy if exists profiles_update        on public.profiles;

-- Any logged-in user can read the directory.
create policy profiles_select on public.profiles
  for select to authenticated using (true);

-- A user can create their own profile row (first-login bootstrap).
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- A user can update their own row; admins/owners can update anyone
-- (e.g. changing roles or active status from the Directory).
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---- shifts ----------------------------------------------------------------
drop policy if exists shifts_select on public.shifts;
drop policy if exists shifts_insert on public.shifts;
drop policy if exists shifts_update on public.shifts;
drop policy if exists shifts_delete on public.shifts;

create policy shifts_select on public.shifts
  for select to authenticated using (true);

create policy shifts_insert on public.shifts
  for insert to authenticated with check (public.is_manager());

create policy shifts_update on public.shifts
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

create policy shifts_delete on public.shifts
  for delete to authenticated using (public.is_manager());

-- ---- time_entries ----------------------------------------------------------
drop policy if exists time_entries_select on public.time_entries;
drop policy if exists time_entries_insert on public.time_entries;
drop policy if exists time_entries_update on public.time_entries;

-- See your own entries; managers+ can see everyone's.
create policy time_entries_select on public.time_entries
  for select to authenticated using (user_id = auth.uid() or public.is_manager());

create policy time_entries_insert on public.time_entries
  for insert to authenticated with check (user_id = auth.uid());

create policy time_entries_update on public.time_entries
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- announcements ---------------------------------------------------------
drop policy if exists announcements_select on public.announcements;
drop policy if exists announcements_insert on public.announcements;
drop policy if exists announcements_update on public.announcements;
drop policy if exists announcements_delete on public.announcements;

create policy announcements_select on public.announcements
  for select to authenticated using (true);

create policy announcements_insert on public.announcements
  for insert to authenticated with check (public.is_manager());

create policy announcements_update on public.announcements
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

create policy announcements_delete on public.announcements
  for delete to authenticated using (public.is_manager());

-- ---- announcement_reads ----------------------------------------------------
drop policy if exists reads_select on public.announcement_reads;
drop policy if exists reads_insert on public.announcement_reads;

-- See your own receipts; managers+ can see all (for read counts).
create policy reads_select on public.announcement_reads
  for select to authenticated using (user_id = auth.uid() or public.is_manager());

create policy reads_insert on public.announcement_reads
  for insert to authenticated with check (user_id = auth.uid());

-- ---- notifications ---------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_update on public.notifications;

-- Only see your own notifications.
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = auth.uid());

-- You can create a notification for yourself; managers+ can notify anyone
-- (e.g. notifying an assignee when a shift is published).
create policy notifications_insert on public.notifications
  for insert to authenticated with check (user_id = auth.uid() or public.is_manager());

-- Only update (mark read) your own notifications.
create policy notifications_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- REALTIME
-- Add the tables the app subscribes to, guarded so re-running won't error.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================================
-- DONE.
-- Next: create your first user (sign up in the app, or Authentication -> Users).
-- To make yourself an owner, run:
--   update public.profiles set role = 'owner' where email = 'you@company.com';
-- ============================================================================
