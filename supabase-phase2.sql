-- ============================================================================
-- GGO Time Management — Phase 2 schema
-- Tables: timesheets, overtime_rules, forms, form_submissions, tasks
-- Run this ONCE in the Supabase SQL Editor, AFTER the Phase 1 files
-- (supabase-schema.sql). Safe to re-run: IF NOT EXISTS / DROP-then-CREATE.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- ROLE HELPERS (re-declared so this file is self-sufficient; identical to the
-- ones in supabase-schema.sql / supabase-rbac-policies.sql).
-- ----------------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('manager','admin','owner'),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('admin','owner'),
    false
  );
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.same_team(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when target is null then true
    else exists (
      select 1
      from public.profiles me
      join public.profiles tgt on tgt.id = target
      where me.id = auth.uid()
        and me.department is not null
        and me.department = tgt.department
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

-- 1) timesheets — weekly hours roll-up with an approval workflow.
create table if not exists public.timesheets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.profiles (id) on delete cascade,
  week_start     date,
  week_end       date,
  total_hours    decimal,
  overtime_hours decimal,
  status         text check (status in ('draft','submitted','approved','rejected')) default 'draft',
  approved_by    uuid references public.profiles (id) on delete set null,
  approved_at    timestamptz,
  notes          text,
  created_at     timestamptz default now(),
  unique (user_id, week_start)   -- one timesheet per person per week (backs upsert)
);

-- 2) overtime_rules — configurable thresholds + pay multiplier.
create table if not exists public.overtime_rules (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  daily_threshold  decimal default 8,
  weekly_threshold decimal default 40,
  multiplier       decimal default 1.5,
  is_active        boolean default true,
  created_at       timestamptz default now()
);

-- 3) forms — form/checklist definitions (fields stored as JSON).
create table if not exists public.forms (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  description  text,
  fields       jsonb,
  is_mandatory boolean default false,
  target_role  text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz default now()
);

-- 4) form_submissions — a user's answers to a form (answers stored as JSON).
create table if not exists public.form_submissions (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid references public.forms (id) on delete cascade,
  submitted_by uuid references public.profiles (id) on delete cascade,
  answers      jsonb,
  submitted_at timestamptz default now()
);

-- 5) tasks — assignable work items for the Kanban board.
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  description text,
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  due_date    timestamptz,
  priority    text check (priority in ('low','medium','high','urgent')) default 'medium',
  status      text check (status in ('pending','in_progress','completed','cancelled')) default 'pending',
  created_at  timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_timesheets_user        on public.timesheets (user_id);
create index if not exists idx_timesheets_week         on public.timesheets (week_start);
create index if not exists idx_timesheets_status       on public.timesheets (status);
create index if not exists idx_forms_target            on public.forms (target_role);
create index if not exists idx_form_subs_form          on public.form_submissions (form_id);
create index if not exists idx_form_subs_user          on public.form_submissions (submitted_by);
create index if not exists idx_tasks_assigned_to       on public.tasks (assigned_to);
create index if not exists idx_tasks_status            on public.tasks (status);

-- ----------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.timesheets        enable row level security;
alter table public.overtime_rules    enable row level security;
alter table public.forms             enable row level security;
alter table public.form_submissions  enable row level security;
alter table public.tasks             enable row level security;

-- ----------------------------------------------------------------------------
-- POLICIES — timesheets
--   own (always), team (managers), all (admins/owners); managers+ approve.
-- ----------------------------------------------------------------------------
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or (public.is_manager() and public.same_team(user_id)));

drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists timesheets_update on public.timesheets;
create policy timesheets_update on public.timesheets
  for update to authenticated
  using (user_id = auth.uid() or public.is_manager())
  with check (user_id = auth.uid() or public.is_manager());

drop policy if exists timesheets_delete on public.timesheets;
create policy timesheets_delete on public.timesheets
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- POLICIES — overtime_rules (everyone reads; only admins/owners edit)
-- ----------------------------------------------------------------------------
drop policy if exists overtime_select on public.overtime_rules;
create policy overtime_select on public.overtime_rules
  for select to authenticated using (true);

drop policy if exists overtime_insert on public.overtime_rules;
create policy overtime_insert on public.overtime_rules
  for insert to authenticated with check (public.is_admin());

drop policy if exists overtime_update on public.overtime_rules;
create policy overtime_update on public.overtime_rules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists overtime_delete on public.overtime_rules;
create policy overtime_delete on public.overtime_rules
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- POLICIES — forms (everyone sees forms aimed at them; only admins/owners build)
-- ----------------------------------------------------------------------------
drop policy if exists forms_select on public.forms;
create policy forms_select on public.forms
  for select to authenticated
  using (target_role is null or target_role = public.my_role() or public.is_admin());

drop policy if exists forms_insert on public.forms;
create policy forms_insert on public.forms
  for insert to authenticated with check (public.is_admin());

drop policy if exists forms_update on public.forms;
create policy forms_update on public.forms
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists forms_delete on public.forms;
create policy forms_delete on public.forms
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- POLICIES — form_submissions (submit your own; admins/owners read all)
-- ----------------------------------------------------------------------------
drop policy if exists form_subs_select on public.form_submissions;
create policy form_subs_select on public.form_submissions
  for select to authenticated using (submitted_by = auth.uid() or public.is_admin());

drop policy if exists form_subs_insert on public.form_submissions;
create policy form_subs_insert on public.form_submissions
  for insert to authenticated with check (submitted_by = auth.uid());

-- ----------------------------------------------------------------------------
-- POLICIES — tasks
--   users see their own assigned tasks; managers+ see all and create/assign.
-- ----------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (assigned_to = auth.uid() or assigned_by = auth.uid() or public.is_manager());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated with check (public.is_manager() and assigned_by = auth.uid());

-- Assignees can advance their own task status; managers+ can update any task.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (assigned_to = auth.uid() or public.is_manager())
  with check (assigned_to = auth.uid() or public.is_manager());

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- SEED — a default overtime rule so the app has something to show.
-- ----------------------------------------------------------------------------
insert into public.overtime_rules (name, daily_threshold, weekly_threshold, multiplier, is_active)
select 'Standard', 8, 40, 1.5, true
where not exists (select 1 from public.overtime_rules);

-- ============================================================================
-- DONE. Phase 2 tables, security and seed data are ready.
-- ============================================================================
