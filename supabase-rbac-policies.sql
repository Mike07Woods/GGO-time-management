-- ============================================================================
-- GGO Time Management — RBAC hardening migration
-- Brings Row Level Security in line with the app's role matrix so the database
-- (not just the UI) enforces who can do what.
--
-- Safe to run on an EXISTING database that already has supabase-schema.sql
-- applied. Idempotent: every object is CREATE OR REPLACE / DROP-then-CREATE.
-- Run it once in the Supabase SQL Editor.
--
-- What this enforces:
--   OWNER   — everything
--   ADMIN   — like owner, but cannot create/modify admin or owner accounts
--   MANAGER — create/manage shifts for their OWN TEAM (same department);
--             announcements read-only; cannot delete; no user management
--   USER    — only their own data; read-only directory/announcements
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROLE HELPER FUNCTIONS (SECURITY DEFINER -> read profiles without RLS recursion)
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

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) = 'owner',
    false
  );
$$;

-- The caller's own role (used to target announcements at a role).
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- True when `target` is on the caller's team (same, non-null department).
-- NULL target (unassigned) is always allowed.
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
-- COLUMN-LEVEL GUARD: protect role / active-status changes on profiles.
-- RLS lets a user update their OWN row (name, phone, avatar). This trigger makes
-- sure that branch can't be abused to self-escalate a role, and pins the
-- admin-can't-touch-admin/owner rule at the row level too.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text;
begin
  -- No end-user in context (SQL Editor, service_role, server-side jobs) -> trusted,
  -- skip the user-facing checks. This keeps the owner-bootstrap UPDATE working.
  if auth.uid() is null then
    return new;
  end if;

  select role into actor from public.profiles where id = auth.uid();

  -- Role changes
  if new.role is distinct from old.role then
    if actor = 'owner' then
      null; -- owner may set any role
    elsif actor = 'admin' then
      if old.role in ('admin','owner') or new.role in ('admin','owner') then
        raise exception 'Admins cannot assign or modify admin/owner roles';
      end if;
    else
      raise exception 'You are not allowed to change roles';
    end if;
  end if;

  -- Active-status changes (activate / deactivate)
  if new.is_active is distinct from old.is_active then
    if actor = 'owner' then
      null;
    elsif actor = 'admin' then
      if old.role in ('admin','owner') then
        raise exception 'Admins cannot change the status of admin/owner accounts';
      end if;
    else
      raise exception 'You are not allowed to change account status';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_update on public.profiles;
create trigger profiles_enforce_update
  before update on public.profiles
  for each row execute function public.enforce_profile_update();

-- ----------------------------------------------------------------------------
-- PROFILES — admins may not modify admin/owner rows (only owners can)
-- ----------------------------------------------------------------------------
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or public.is_owner()
    or (public.is_admin() and role not in ('admin','owner'))
  )
  with check (
    id = auth.uid()
    or public.is_owner()
    or (public.is_admin() and role not in ('admin','owner'))
  );

-- ----------------------------------------------------------------------------
-- SHIFTS — users see only their own; managers create/assign for their team;
-- only admins/owners may hard-delete.
-- ----------------------------------------------------------------------------
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (public.is_manager() or assigned_to = auth.uid() or created_by = auth.uid());

drop policy if exists shifts_insert on public.shifts;
create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (public.is_admin() or (public.is_manager() and public.same_team(assigned_to)))
  );

-- Managers+ may publish/cancel any shift they can see. (Team scoping is enforced
-- at insert time, above — that's where assignment happens.)
drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists shifts_delete on public.shifts;
create policy shifts_delete on public.shifts
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- ANNOUNCEMENTS — only admins/owners may create/edit/delete; users & managers
-- read only the announcements aimed at them.
-- ----------------------------------------------------------------------------
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (target_role is null or target_role = public.my_role() or public.is_admin());

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated with check (public.is_admin());

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- ANNOUNCEMENT READS — read receipts visible to the owner of the receipt and to
-- admins/owners (who post and track them).
-- ----------------------------------------------------------------------------
drop policy if exists reads_select on public.announcement_reads;
create policy reads_select on public.announcement_reads
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ============================================================================
-- DONE. The database now enforces the same rules as the UI.
-- ============================================================================
