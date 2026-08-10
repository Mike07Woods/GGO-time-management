-- ============================================================================
-- GGO Time Management — Server-side disposition segment logging
-- Makes time_entry_breaks the single source of truth, managed atomically by DB
-- triggers so rapid disposition switches can't race into overlapping/orphan
-- open segments (the old client-side open/close was race-prone). Run once; safe
-- to re-run. Requires supabase-team-status.sql (time_entry_breaks table).
-- ============================================================================

-- Ensure exactly ONE open segment of p_kind for an entry: close any open segment
-- of a different kind, then open one for p_kind if not already open. Idempotent.
create or replace function public.fn_sync_disposition(p_user uuid, p_entry uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_entry is null then
    return;
  end if;

  update public.time_entry_breaks
     set ended_at = now()
   where time_entry_id = p_entry and ended_at is null and kind is distinct from p_kind;

  if p_kind is not null and p_kind <> 'Offline'
     and not exists (
       select 1 from public.time_entry_breaks
        where time_entry_id = p_entry and ended_at is null and kind = p_kind
     ) then
    insert into public.time_entry_breaks (time_entry_id, user_id, kind, started_at)
    values (p_entry, p_user, p_kind, now());
  end if;
end;
$$;

-- Clock in -> open the first (Active) segment.
create or replace function public.fn_seg_on_clockin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_sync_disposition(new.user_id, new.id, 'Active');
  return new;
end;
$$;
drop trigger if exists seg_on_clockin on public.time_entries;
create trigger seg_on_clockin after insert on public.time_entries
  for each row execute function public.fn_seg_on_clockin();

-- Clock out (entry completed) -> close any open segment at clock-out time.
create or replace function public.fn_seg_on_clockout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.time_entry_breaks
       set ended_at = coalesce(new.clock_out, now())
     where time_entry_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists seg_on_clockout on public.time_entries;
create trigger seg_on_clockout after update on public.time_entries
  for each row execute function public.fn_seg_on_clockout();

-- Disposition change (presence) -> sync the segment for the user's open shift.
-- Works no matter which UI changed it (Time Clock buttons OR header menu).
create or replace function public.fn_seg_on_presence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid;
  v_kind  text;
begin
  if tg_op = 'UPDATE' and new.status_type_id is not distinct from old.status_type_id then
    return new; -- heartbeat / no status change
  end if;

  select id into v_entry from public.time_entries
    where user_id = new.user_id and status <> 'completed'
    order by clock_in desc limit 1;
  if v_entry is null then
    return new; -- not clocked in
  end if;

  select name into v_kind from public.status_types where id = new.status_type_id;
  perform public.fn_sync_disposition(new.user_id, v_entry, v_kind);
  return new;
end;
$$;
drop trigger if exists seg_on_presence on public.user_presence;
create trigger seg_on_presence after insert or update on public.user_presence
  for each row execute function public.fn_seg_on_presence();

-- ----------------------------------------------------------------------------
-- One-time cleanup of the existing overlapping / orphaned open segments.
-- ----------------------------------------------------------------------------
-- Close any open segment that has a LATER segment in the same entry, at that
-- later segment's start (so only the newest segment per entry stays open).
update public.time_entry_breaks t
   set ended_at = (
     select min(t2.started_at) from public.time_entry_breaks t2
      where t2.time_entry_id = t.time_entry_id and t2.started_at > t.started_at
   )
 where t.ended_at is null
   and exists (
     select 1 from public.time_entry_breaks t2
      where t2.time_entry_id = t.time_entry_id and t2.started_at > t.started_at
   );

-- Close any still-open segment that belongs to an already-completed entry.
update public.time_entry_breaks t
   set ended_at = coalesce((select clock_out from public.time_entries e where e.id = t.time_entry_id), now())
 where t.ended_at is null
   and exists (select 1 from public.time_entries e where e.id = t.time_entry_id and e.status = 'completed');

-- ============================================================================
-- DONE. Disposition segments are now managed by the database.
-- ============================================================================
