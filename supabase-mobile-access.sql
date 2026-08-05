-- ============================================================================
-- GGO Time Management — Per-user mobile (phone) access
-- Anyone can only open the app on a phone if mobile_access = true. The OWNER is
-- always allowed and is the only role that can change the flag. Run once; safe
-- to re-run.
-- ============================================================================

alter table public.profiles add column if not exists mobile_access boolean default false;

-- Guard: only the OWNER may change mobile_access (so nobody — not even an admin
-- — can grant themselves phone access). Separate BEFORE-UPDATE trigger so it
-- doesn't touch the existing enforce_profile_update function.
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
    if actor <> 'owner' then
      raise exception 'Only the owner can change mobile access';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_mobile on public.profiles;
create trigger profiles_enforce_mobile
  before update on public.profiles
  for each row execute function public.enforce_mobile_access();

-- Grant every existing active user phone access on install, so nobody is
-- suddenly locked out. The owner then denies whoever they want (and new users
-- default to denied via the column default until the owner enables them).
update public.profiles set mobile_access = true where mobile_access is distinct from true;

-- ============================================================================
-- DONE. Toggle mobile access per employee in User Management.
-- ============================================================================
