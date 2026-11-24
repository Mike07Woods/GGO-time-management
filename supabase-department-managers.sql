-- ============================================================================
-- GGO Time Management — multiple managers per department
-- Run once in the Supabase SQL Editor (after supabase-departments.sql). Safe to re-run.
-- Replaces the single departments.manager_id with a join table. The old column
-- is left in place (unused by the app) so nothing is lost; drop it later if wanted.
-- ============================================================================

create table if not exists public.department_managers (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz default now(),
  primary key (department_id, user_id)
);

create index if not exists idx_department_managers_user on public.department_managers (user_id);

-- Carry over existing single-manager assignments.
insert into public.department_managers (department_id, user_id)
select id, manager_id from public.departments where manager_id is not null
on conflict do nothing;

alter table public.department_managers enable row level security;

-- Everyone signed in can read (Departments page + each manager's own team scope).
drop policy if exists department_managers_select on public.department_managers;
create policy department_managers_select on public.department_managers
  for select to authenticated using (true);

-- Only owners/admins can add or remove managers.
drop policy if exists department_managers_manage on public.department_managers;
create policy department_managers_manage on public.department_managers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- DONE.
-- ============================================================================
