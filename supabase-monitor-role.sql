-- ============================================================================
-- GGO Time Management — "monitor" role (department-scoped, read-only)
-- Run once; safe to re-run.
-- NOTE: scoping is by department_id (the column your app actually assigns), not
-- the legacy `department` text column.
-- ============================================================================

-- 1) Allow 'monitor' as a role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'manager', 'monitor', 'user'));

-- 2) Monitors get manager-level READ access (RLS) so pages can load data; the
--    app then filters everything to the monitor's own department. (Department
--    scoping is enforced in the UI, not RLS — see the feature notes.)
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('manager', 'admin', 'owner', 'monitor'),
    false
  );
$$;

-- 3) Helper: the current user's department_id (used by department-aware RLS, if
--    added later). Returns null for non-departmental users.
create or replace function public.get_monitor_department()
returns uuid language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid();
$$;

-- ============================================================================
-- DONE. Assign someone the 'monitor' role + a department in User Management.
-- ============================================================================
