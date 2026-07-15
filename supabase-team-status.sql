-- ============================================================================
-- GGO Time Management — Live Team Status Monitor
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- Status definitions (customizable)
create table if not exists public.status_types (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  color      text not null default '#6B7280',
  emoji      text,
  is_afk     boolean default false,
  is_system  boolean default false,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Seed default statuses (only if the table is empty).
insert into public.status_types (name, color, emoji, is_afk, is_system, sort_order)
select * from (values
  ('Active',     '#00D15E', '🟢', false, true,  1),
  ('On Break',   '#F59E0B', '🟡', false, true,  2),
  ('AFK',        '#EF4444', '🔴', true,  true,  3),
  ('Offline',    '#6B7280', '⚫', false, false, 4),
  ('In Meeting', '#8B5CF6', '🟣', false, false, 5),
  ('On Call',    '#3B82F6', '🔵', false, false, 6)
) as v(name, color, emoji, is_afk, is_system, sort_order)
where not exists (select 1 from public.status_types);

-- Live presence (one row per user)
create table if not exists public.user_presence (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references public.profiles (id) on delete cascade unique,
  status_type_id uuid references public.status_types (id),
  custom_note    text,
  last_active_at timestamptz default now(),
  afk_at         timestamptz,
  updated_at     timestamptz default now()
);

-- Ping notifications
create table if not exists public.status_pings (
  id           uuid default gen_random_uuid() primary key,
  from_user_id uuid references public.profiles (id) on delete cascade,
  to_user_id   uuid references public.profiles (id) on delete cascade,
  message      text,
  read         boolean default false,
  created_at   timestamptz default now()
);

-- Org-wide status settings (single row)
create table if not exists public.status_settings (
  id                  uuid default gen_random_uuid() primary key,
  afk_timeout_minutes int default 15,
  ping_cooldown_minutes int default 5,
  allow_custom_notes  boolean default true,
  updated_at          timestamptz default now()
);

insert into public.status_settings (afk_timeout_minutes, ping_cooldown_minutes)
select 15, 5 where not exists (select 1 from public.status_settings);

create index if not exists idx_presence_user on public.user_presence (user_id);
create index if not exists idx_pings_to on public.status_pings (to_user_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.status_types enable row level security;
alter table public.user_presence enable row level security;
alter table public.status_pings enable row level security;
alter table public.status_settings enable row level security;

drop policy if exists status_types_select on public.status_types;
create policy status_types_select on public.status_types for select to authenticated using (true);

drop policy if exists status_types_manage on public.status_types;
create policy status_types_manage on public.status_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists presence_select on public.user_presence;
create policy presence_select on public.user_presence for select to authenticated using (true);

drop policy if exists presence_own on public.user_presence;
create policy presence_own on public.user_presence for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists pings_select on public.status_pings;
create policy pings_select on public.status_pings for select to authenticated
  using (to_user_id = auth.uid() or from_user_id = auth.uid());

-- Only managers/admins/owners may send pings (matches the UI). Enforced here so
-- the API can't be used to bypass the button and spam notifications.
drop policy if exists pings_insert on public.status_pings;
create policy pings_insert on public.status_pings for insert to authenticated
  with check (from_user_id = auth.uid() and public.is_manager());

drop policy if exists settings_manage on public.status_settings;
create policy settings_manage on public.status_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Everyone signed in can READ the settings (the presence hook needs the timeout).
drop policy if exists settings_select on public.status_settings;
create policy settings_select on public.status_settings for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- Ping -> in-app notification (automatic)
-- ----------------------------------------------------------------------------
create or replace function public.fn_ping_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare sender text;
begin
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email)
    into sender from public.profiles where id = new.from_user_id;
  insert into public.notifications (user_id, title, body, type)
  values (
    new.to_user_id,
    'You were pinged',
    coalesce(sender, 'Someone') || ' pinged you'
      || case when coalesce(new.message, '') <> '' then ': ' || new.message else '' end,
    'ping'
  );
  return new;
end;
$$;

drop trigger if exists on_status_ping on public.status_pings;
create trigger on_status_ping after insert on public.status_pings
  for each row execute function public.fn_ping_notification();

-- ----------------------------------------------------------------------------
-- Realtime (guarded so re-running won't error)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_presence') then
    alter publication supabase_realtime add table public.user_presence;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='status_pings') then
    alter publication supabase_realtime add table public.status_pings;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Presence history (for analytics). One row per status change; duration of a
-- row = time until the next row (or now). Managers+ can read it.
-- ----------------------------------------------------------------------------
create table if not exists public.presence_log (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references public.profiles (id) on delete cascade,
  status_type_id uuid references public.status_types (id),
  started_at     timestamptz default now()
);

create index if not exists idx_presence_log_user_time on public.presence_log (user_id, started_at);

alter table public.presence_log enable row level security;

drop policy if exists presence_log_select on public.presence_log;
create policy presence_log_select on public.presence_log for select to authenticated
  using (public.is_manager());

create or replace function public.fn_log_presence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') or (new.status_type_id is distinct from old.status_type_id) then
    insert into public.presence_log (user_id, status_type_id, started_at)
    values (new.user_id, new.status_type_id, now());
  end if;
  return new;
end;
$$;

drop trigger if exists on_presence_change on public.user_presence;
create trigger on_presence_change after insert or update on public.user_presence
  for each row execute function public.fn_log_presence();

-- ----------------------------------------------------------------------------
-- Per-disposition time limit (minutes). Null = no limit. When a user stays in a
-- status past this, the monitor flags it and the user gets a notification.
-- ----------------------------------------------------------------------------
alter table public.status_types add column if not exists max_minutes int;
update public.status_types set max_minutes = 30 where name = 'On Break' and max_minutes is null;

-- Remembers which status-instance (by its updated_at) we've already alerted on,
-- so managers are notified once per overrun — not every minute.
alter table public.user_presence add column if not exists overrun_alerted_for timestamptz;

-- ----------------------------------------------------------------------------
-- Server-side over-limit alerting (runs on a schedule via pg_cron, so managers
-- are notified even when nobody has the monitor open).
-- Notifies admins/owners always, and managers in the same department as the
-- offender. Fires once per status instance.
-- ----------------------------------------------------------------------------
create or replace function public.fn_check_disposition_overruns()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select up.user_id,
           up.updated_at,
           st.name        as status_name,
           st.max_minutes,
           p.department_id as user_dept,
           coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email) as person
    from public.user_presence up
    join public.status_types st on st.id = up.status_type_id
    join public.profiles p on p.id = up.user_id
    where st.max_minutes is not null
      and up.updated_at < now() - make_interval(mins => st.max_minutes)
      and (up.overrun_alerted_for is null or up.overrun_alerted_for <> up.updated_at)
  loop
    insert into public.notifications (user_id, title, body, type)
    select mgr.id,
           'Disposition time exceeded',
           r.person || ' has been "' || r.status_name || '" for over ' || r.max_minutes || ' minutes.',
           'status_overrun'
    from public.profiles mgr
    where mgr.is_active = true
      and mgr.id <> r.user_id
      and (
        mgr.role in ('admin', 'owner')
        or (mgr.role = 'manager' and mgr.department_id is not distinct from r.user_dept)
      );

    update public.user_presence set overrun_alerted_for = r.updated_at where user_id = r.user_id;
  end loop;
end;
$$;

-- Schedule it every minute. Requires pg_cron (enable under Database -> Extensions
-- if the CREATE EXTENSION line errors, then re-run this file).
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('disposition-overrun-check');
exception
  when others then null; -- job didn't exist yet
end $$;

select cron.schedule('disposition-overrun-check', '* * * * *',
  $$ select public.fn_check_disposition_overruns(); $$);

-- ============================================================================
-- DONE. The Team Status page + presence indicators will now work.
-- ============================================================================
