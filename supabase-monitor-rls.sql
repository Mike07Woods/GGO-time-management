-- ============================================================================
-- GGO Time Management — Monitor role: DATABASE-level department enforcement
-- Hardens the monitor role so its department scope is enforced by RLS, not just
-- the UI. Run AFTER supabase-monitor-role.sql. Safe to re-run.
--
-- What changes:
--   * is_manager() NO LONGER includes monitor -> monitor loses blanket
--     manager-level read (and any incidental write) and becomes truly read-only.
--   * New additive SELECT policies let a monitor read ONLY their own department's
--     rows. A monitor querying another department via the API now gets nothing.
-- Owner / admin / manager / user behaviour is unchanged.
-- ============================================================================

-- 1) Revert is_manager() to exclude monitor.
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('manager', 'admin', 'owner'),
    false
  );
$$;

-- 2) Is `target_user` in the calling monitor's department? SECURITY DEFINER so it
--    bypasses RLS (no recursion when used inside policies).
create or replace function public.same_dept_as_monitor(target_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.my_role() = 'monitor'
    and public.get_monitor_department() is not null
    and (select department_id from public.profiles where id = target_user) = public.get_monitor_department();
$$;

-- 3) Department-scoped SELECT policies for monitors. These are ADDITIVE (RLS is
--    permissive / OR-combined) — they sit alongside the existing own-row and
--    manager policies and only widen access for monitors, to their department.

-- profiles: a monitor can read people in their department.
drop policy if exists profiles_monitor_dept on public.profiles;
create policy profiles_monitor_dept on public.profiles for select to authenticated
using (
  public.my_role() = 'monitor'
  and department_id is not null
  and department_id = public.get_monitor_department()
);

-- time_entries / breaks / timesheets: keyed on the row's user_id.
drop policy if exists time_entries_monitor_dept on public.time_entries;
create policy time_entries_monitor_dept on public.time_entries for select to authenticated
using (public.same_dept_as_monitor(user_id));

drop policy if exists teb_monitor_dept on public.time_entry_breaks;
create policy teb_monitor_dept on public.time_entry_breaks for select to authenticated
using (public.same_dept_as_monitor(user_id));

drop policy if exists timesheets_monitor_dept on public.timesheets;
create policy timesheets_monitor_dept on public.timesheets for select to authenticated
using (public.same_dept_as_monitor(user_id));

-- shifts / tasks: keyed on assigned_to.
drop policy if exists shifts_monitor_dept on public.shifts;
create policy shifts_monitor_dept on public.shifts for select to authenticated
using (public.same_dept_as_monitor(assigned_to));

drop policy if exists tasks_monitor_dept on public.tasks;
create policy tasks_monitor_dept on public.tasks for select to authenticated
using (public.same_dept_as_monitor(assigned_to));

-- ============================================================================
-- DONE. Monitors are now confined to their department at the database level.
-- (departments + overtime_rules remain readable to all authenticated users —
--  names/thresholds only, no personal data.)
-- ============================================================================
