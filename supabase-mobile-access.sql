-- ============================================================================
-- GGO Time Management — Per-user mobile (phone) access
-- Employees can only open the app on a phone if mobile_access = true. Managers,
-- admins and owners are always allowed. Run once; safe to re-run.
-- ============================================================================

alter table public.profiles add column if not exists mobile_access boolean default false;

-- Guard: a user must NOT be able to grant themselves phone access. Only
-- admins/owners may change mobile_access (this is a separate BEFORE-UPDATE
-- trigger so it doesn't touch the existing enforce_profile_update function).
create or replace function public.enforce_mobile_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text;
begin
  if auth.uid() is null then
    return new; -- trusted context (SQL editor / service role)
  end if;
  if new.mobile_access is distinct from old.mobile_access then
    select role into actor from public.profiles where id = auth.uid();
    if actor not in ('admin', 'owner') then
      raise exception 'Only admins/owners can change mobile access';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_mobile on public.profiles;
create trigger profiles_enforce_mobile
  before update on public.profiles
  for each row execute function public.enforce_mobile_access();

-- Optional: grant existing managers+ mobile access explicitly (they're allowed
-- anyway by role, but this keeps the flag tidy).
update public.profiles set mobile_access = true
  where role in ('manager', 'admin', 'owner') and mobile_access is distinct from true;

-- ============================================================================
-- DONE. Toggle mobile access per employee in User Management.
-- ============================================================================
