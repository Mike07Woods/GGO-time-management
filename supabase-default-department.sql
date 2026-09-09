-- ============================================================================
-- GGO Time Management — Default new users to the "Operations" department
-- Any newly-created profile with no department is placed in Operations. This is
-- a DB-level default, so it applies no matter how the user is created (self
-- sign-up, the handle_new_user trigger, or manual insert). It only fires on
-- INSERT when department_id is null, so a department you set later in the app is
-- never overwritten. Run once; safe to re-run.
-- ============================================================================

-- 1) Make sure an "Operations" department exists.
insert into public.departments (name)
select 'Operations'
where not exists (select 1 from public.departments where lower(name) = 'operations');

-- 2) On new profiles, default department_id to Operations when it's not set.
create or replace function public.set_default_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.department_id is null then
    new.department_id := (
      select id from public.departments where lower(name) = 'operations' limit 1
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_default_department on public.profiles;
create trigger profiles_default_department
  before insert on public.profiles
  for each row execute function public.set_default_department();

-- ============================================================================
-- DONE. New users now land in Operations by default; change it any time in
-- User Management.
-- ============================================================================
