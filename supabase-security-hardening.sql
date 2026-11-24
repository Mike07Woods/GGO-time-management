-- ============================================================================
-- GGO Time Management — security hardening + team scoping fix
-- Applied to the live project; kept here so the repo matches the database.
-- Safe to re-run.
-- ============================================================================

-- 1) same_team(): who counts as "my team" for RLS. It used the legacy
--    profiles.department TEXT column, which is empty for everyone, so managers
--    could not see team timesheets or create team shifts. It now uses
--    department_id + department_managers. Monitors are deliberately NOT included
--    (is_manager() includes them, and shifts_insert would then let them write).
create or replace function public.same_team(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when target is null then true
    when target = auth.uid() then true
    else exists (
      select 1
      from public.profiles me
      join public.profiles tgt on tgt.id = target
      where me.id = auth.uid()
        and me.role = 'manager'
        and tgt.department_id in (
          select dm.department_id from public.department_managers dm where dm.user_id = me.id
        )
    )
  end;
$$;

-- 2) Stop the public API (RPC) exposing internal SECURITY DEFINER functions.
--    fn_sync_disposition could edit anyone's status segments with no auth check;
--    the other two are cron-only (pg_cron runs as the owner, so is unaffected).
revoke execute on function public.fn_sync_disposition(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_run_auto_clockout() from public, anon, authenticated;
revoke execute on function public.fn_check_disposition_overruns() from public, anon, authenticated;
-- Used by the app, but only for signed-in users.
revoke execute on function public.increment_article_views(uuid) from public, anon;
grant execute on function public.increment_article_views(uuid) to authenticated;
revoke execute on function public.answer_time_prompt(text) from public, anon;
grant execute on function public.answer_time_prompt(text) to authenticated;

-- 3a) Timesheets: only managers and above may approve/reject or set approver
--     fields. Employees can still create, edit and (re)submit their own.
create or replace function public.enforce_timesheet_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text;
begin
  if auth.uid() is null then return new; end if; -- SQL editor / service role / jobs
  select role into actor from public.profiles where id = auth.uid();
  if actor in ('manager', 'admin', 'owner') then return new; end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, 'draft') not in ('draft', 'submitted') then
      raise exception 'Only a manager can approve or reject a timesheet';
    end if;
    if new.approved_by is not null or new.approved_at is not null then
      raise exception 'Only a manager can approve a timesheet';
    end if;
    return new;
  end if;

  if old.status = 'approved' then
    raise exception 'Approved timesheets can only be changed by a manager';
  end if;
  if coalesce(new.status, 'draft') not in ('draft', 'submitted') then
    raise exception 'Only a manager can approve or reject a timesheet';
  end if;
  if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    raise exception 'Only a manager can approve a timesheet';
  end if;
  return new;
end;
$$;

drop trigger if exists timesheets_enforce_update on public.timesheets;
create trigger timesheets_enforce_update
  before insert or update on public.timesheets
  for each row execute function public.enforce_timesheet_update();

-- 3b) Time entries: employees can break/resume/clock out, but cannot move
--     clock_in or reassign an entry, and cannot edit an entry once completed.
create or replace function public.enforce_time_entry_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text;
begin
  if auth.uid() is null then return new; end if; -- cron auto-clockout, etc.
  select role into actor from public.profiles where id = auth.uid();
  if actor in ('manager', 'admin', 'owner') then return new; end if;

  if old.status = 'completed' then
    raise exception 'Completed time entries can only be corrected by a manager';
  end if;
  if new.user_id is distinct from old.user_id or new.clock_in is distinct from old.clock_in then
    raise exception 'You cannot change the clock-in time';
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_enforce_update on public.time_entries;
create trigger time_entries_enforce_update
  before update on public.time_entries
  for each row execute function public.enforce_time_entry_update();

-- 3c) So that corrections are possible at all: admins/owners, and managers for
--     their own team, may update time entries (previously only the owner of the
--     entry could).
drop policy if exists time_entries_update_team on public.time_entries;
create policy time_entries_update_team on public.time_entries
  for update to authenticated
  using (
    public.is_admin()
    or ((select role from public.profiles where id = auth.uid()) = 'manager' and public.same_team(user_id))
  )
  with check (
    public.is_admin()
    or ((select role from public.profiles where id = auth.uid()) = 'manager' and public.same_team(user_id))
  );

-- 3d) The new trigger functions run as triggers only; keep them off the public API.
revoke execute on function public.enforce_timesheet_update() from public, anon, authenticated;
revoke execute on function public.enforce_time_entry_update() from public, anon, authenticated;
