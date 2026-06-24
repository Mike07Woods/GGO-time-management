-- ============================================================================
-- GGO Time Management — Directory RLS split (security hardening)
-- Splits "read one profile for a name lookup" from "list the full directory".
--
-- Run ONCE in the Supabase SQL Editor (after the Phase 1–3 files).
-- Idempotent: DROP-then-CREATE / CREATE OR REPLACE throughout.
--
-- WHY A VIEW IS REQUIRED
-- ----------------------
-- RLS is row-level, and every logged-in user shares the single `authenticated`
-- role, so a policy cannot return "all rows but only the name columns" for some
-- roles and "all columns" for others. We therefore:
--   1) restrict the base `profiles` table to own-row (regular users) / all
--      (managers+), and
--   2) expose a sanitized VIEW `profiles_public` (id + names + avatar only) that
--      everyone can read for name/avatar lookups.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Restrict the base table.
--    Regular users: only their OWN full profile.
--    Managers / admins / owners: the full directory (all rows).
--    (is_manager() is the SECURITY DEFINER helper from the Phase 1 hardening.)
-- ----------------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('manager','admin','owner'), false);
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_manager());

-- ----------------------------------------------------------------------------
-- 2) Sanitized lookup view: basic, non-sensitive fields for EVERY user.
--    Safe to read by any authenticated user — exposes no email, phone,
--    department, position, role or status. `is_active` is included only so the
--    existing `.eq('is_active', true)` filters keep working.
--
--    security_invoker = false (the default) -> the view runs with its owner's
--    (postgres) privileges and bypasses the restrictive base-table policy above,
--    but can only ever return the columns selected here.
-- ----------------------------------------------------------------------------
drop view if exists public.profiles_public;
create view public.profiles_public
with (security_invoker = false) as
  select
    id,
    first_name,
    last_name,
    avatar_url,
    is_active
  from public.profiles;

-- Only logged-in users may read it (never anonymous visitors).
revoke all on public.profiles_public from anon, public;
grant select on public.profiles_public to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Ask PostgREST to reload its schema cache so the new view is queryable
--    immediately from the client.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- DONE.
--   * Full directory (profiles.*)  -> own row, or manager/admin/owner.
--   * Name/avatar lookups          -> profiles_public, any authenticated user.
--
-- App change required (already done in the matching commit): Chat, HelpDesk and
-- Events read their people list from `profiles_public` instead of `profiles`.
-- All other lookups were verified safe against the new policy.
-- ============================================================================
