-- ============================================================================
-- GGO Time Management — Departments
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- Departments table
create table if not exists public.departments (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  description text,
  manager_id  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz default now()
);

-- Link profiles -> departments
alter table public.profiles
  add column if not exists department_id uuid references public.departments (id) on delete set null;

create index if not exists idx_profiles_department on public.profiles (department_id);
create index if not exists idx_departments_manager on public.departments (manager_id);

-- RLS
alter table public.departments enable row level security;

-- Everyone signed in can read departments (needed for the directory / dropdowns).
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated using (true);

-- Only owners/admins can create / edit / delete departments.
-- (public.is_admin() is the SECURITY DEFINER helper from the Phase 1 hardening.)
drop policy if exists departments_manage on public.departments;
create policy departments_manage on public.departments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- DONE. The app's User Management + Departments pages will use these.
-- ============================================================================
