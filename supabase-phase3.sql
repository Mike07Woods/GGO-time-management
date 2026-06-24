-- ============================================================================
-- GGO Time Management — Phase 3 schema (final phase)
-- Tables: chat_channels, chat_messages, knowledge_articles, helpdesk_tickets,
--         helpdesk_comments, events, event_rsvps, audit_logs
-- Plus: audit-logging triggers on existing tables + chat realtime.
--
-- Run ONCE in the Supabase SQL Editor AFTER the Phase 1 and Phase 2 files.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE throughout.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- ROLE HELPERS (re-declared so this file is self-sufficient).
-- ----------------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('manager','admin','owner'), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('admin','owner'), false);
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'owner', false);
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

create table if not exists public.chat_channels (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  type       text check (type in ('direct','group','announcement')),
  created_by uuid references public.profiles (id) on delete set null,
  members    uuid[],
  created_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid references public.chat_channels (id) on delete cascade,
  sender_id  uuid references public.profiles (id) on delete set null,
  content    text,
  is_read    boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.knowledge_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  content      text,
  category     text,
  tags         text[],
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  is_published boolean default true,
  views        integer default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.helpdesk_tickets (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  description  text,
  category     text,
  priority     text check (priority in ('low','medium','high','urgent')) default 'medium',
  status       text check (status in ('open','in_progress','resolved','closed')) default 'open',
  submitted_by uuid references public.profiles (id) on delete set null,
  assigned_to  uuid references public.profiles (id) on delete set null,
  resolution   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.helpdesk_comments (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid references public.helpdesk_tickets (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  content    text,
  created_at timestamptz default now()
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  description text,
  location    text,
  start_time  timestamptz,
  end_time    timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  target_role text,
  created_at  timestamptz default now()
);

create table if not exists public.event_rsvps (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references public.events (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  status     text check (status in ('attending','not_attending','maybe')),
  created_at timestamptz default now(),
  unique (event_id, user_id)   -- one RSVP per person per event (backs upsert)
);

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete set null,
  action        text,
  resource_type text,
  resource_id   text,
  old_value     jsonb,
  new_value     jsonb,
  ip_address    text,
  created_at    timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_chat_messages_channel  on public.chat_messages (channel_id);
create index if not exists idx_chat_channels_members   on public.chat_channels using gin (members);
create index if not exists idx_knowledge_category      on public.knowledge_articles (category);
create index if not exists idx_tickets_submitted_by    on public.helpdesk_tickets (submitted_by);
create index if not exists idx_tickets_status          on public.helpdesk_tickets (status);
create index if not exists idx_comments_ticket         on public.helpdesk_comments (ticket_id);
create index if not exists idx_events_start            on public.events (start_time);
create index if not exists idx_rsvps_event             on public.event_rsvps (event_id);
create index if not exists idx_audit_user              on public.audit_logs (user_id);
create index if not exists idx_audit_created           on public.audit_logs (created_at);

-- ----------------------------------------------------------------------------
-- HELPER FUNCTIONS specific to Phase 3
-- ----------------------------------------------------------------------------

-- Is the current user a member of this chat channel? (SECURITY DEFINER avoids
-- recursive RLS when chat_messages policies check chat_channels.)
create or replace function public.is_channel_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channels c where c.id = cid and auth.uid() = any (c.members)
  );
$$;

-- Increment an article's view count regardless of the admin-only update policy.
create or replace function public.increment_article_views(article_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.knowledge_articles set views = coalesce(views, 0) + 1 where id = article_id;
$$;

-- ----------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.chat_channels       enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.knowledge_articles  enable row level security;
alter table public.helpdesk_tickets    enable row level security;
alter table public.helpdesk_comments   enable row level security;
alter table public.events              enable row level security;
alter table public.event_rsvps         enable row level security;
alter table public.audit_logs          enable row level security;

-- ---- chat_channels ---------------------------------------------------------
drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels
  for select to authenticated using (auth.uid() = any (members));

-- Direct channels: anyone; group channels: managers+.
drop policy if exists chat_channels_insert on public.chat_channels;
create policy chat_channels_insert on public.chat_channels
  for insert to authenticated
  with check (created_by = auth.uid() and (type = 'direct' or public.is_manager()));

drop policy if exists chat_channels_update on public.chat_channels;
create policy chat_channels_update on public.chat_channels
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

-- ---- chat_messages ---------------------------------------------------------
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated using (public.is_channel_member(channel_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_channel_member(channel_id));

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update to authenticated
  using (public.is_channel_member(channel_id))
  with check (public.is_channel_member(channel_id));

-- ---- knowledge_articles ----------------------------------------------------
drop policy if exists knowledge_select on public.knowledge_articles;
create policy knowledge_select on public.knowledge_articles
  for select to authenticated using (is_published or public.is_admin());

drop policy if exists knowledge_insert on public.knowledge_articles;
create policy knowledge_insert on public.knowledge_articles
  for insert to authenticated with check (public.is_admin());

drop policy if exists knowledge_update on public.knowledge_articles;
create policy knowledge_update on public.knowledge_articles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists knowledge_delete on public.knowledge_articles;
create policy knowledge_delete on public.knowledge_articles
  for delete to authenticated using (public.is_admin());

-- ---- helpdesk_tickets ------------------------------------------------------
drop policy if exists tickets_select on public.helpdesk_tickets;
create policy tickets_select on public.helpdesk_tickets
  for select to authenticated
  using (submitted_by = auth.uid() or assigned_to = auth.uid() or public.is_manager());

drop policy if exists tickets_insert on public.helpdesk_tickets;
create policy tickets_insert on public.helpdesk_tickets
  for insert to authenticated with check (submitted_by = auth.uid());

-- Only managers+ update tickets (status / assignment / resolution).
drop policy if exists tickets_update on public.helpdesk_tickets;
create policy tickets_update on public.helpdesk_tickets
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---- helpdesk_comments -----------------------------------------------------
drop policy if exists comments_select on public.helpdesk_comments;
create policy comments_select on public.helpdesk_comments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_manager()
    or exists (
      select 1 from public.helpdesk_tickets t
      where t.id = ticket_id and (t.submitted_by = auth.uid() or t.assigned_to = auth.uid())
    )
  );

drop policy if exists comments_insert on public.helpdesk_comments;
create policy comments_insert on public.helpdesk_comments
  for insert to authenticated with check (user_id = auth.uid());

-- ---- events ----------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (target_role is null or target_role = public.my_role() or public.is_admin());

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (public.is_manager());

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated using (public.is_admin());

-- ---- event_rsvps -----------------------------------------------------------
-- Attendee lists are visible to everyone; you can only set your own RSVP.
drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps
  for select to authenticated using (true);

drop policy if exists rsvps_insert on public.event_rsvps;
create policy rsvps_insert on public.event_rsvps
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists rsvps_update on public.event_rsvps;
create policy rsvps_update on public.event_rsvps
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- audit_logs ------------------------------------------------------------
-- Owner-only read. No insert policy: rows are written by SECURITY DEFINER
-- triggers (below), which bypass RLS.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select to authenticated using (public.is_owner());

-- ============================================================================
-- AUDIT LOGGING — triggers on existing tables auto-record key actions.
-- All functions are SECURITY DEFINER so they can write to audit_logs.
-- ============================================================================

create or replace function public.fn_audit_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
    values (auth.uid(), 'user_created', 'profile', new.id::text, to_jsonb(new));
  elsif TG_OP = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into public.audit_logs(user_id, action, resource_type, resource_id, old_value, new_value)
      values (auth.uid(), 'role_changed', 'profile', new.id::text,
              jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
    else
      insert into public.audit_logs(user_id, action, resource_type, resource_id, old_value, new_value)
      values (auth.uid(), 'user_updated', 'profile', new.id::text, to_jsonb(old), to_jsonb(new));
    end if;
  elsif TG_OP = 'DELETE' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, old_value)
    values (auth.uid(), 'user_deleted', 'profile', old.id::text, to_jsonb(old));
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.fn_audit_profiles();

create or replace function public.fn_audit_shifts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
    values (auth.uid(), 'shift_created', 'shift', new.id::text, to_jsonb(new));
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, old_value, new_value)
    values (auth.uid(),
            case new.status when 'published' then 'shift_published'
                            when 'cancelled' then 'shift_cancelled'
                            else 'shift_updated' end,
            'shift', new.id::text,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_shifts on public.shifts;
create trigger audit_shifts
  after insert or update on public.shifts
  for each row execute function public.fn_audit_shifts();

create or replace function public.fn_audit_time_entries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
    values (auth.uid(), 'clock_in', 'time_entry', new.id::text,
            jsonb_build_object('clock_in', new.clock_in, 'lat', new.clock_in_lat, 'lng', new.clock_in_lng));
  elsif TG_OP = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
    values (auth.uid(), 'clock_out', 'time_entry', new.id::text,
            jsonb_build_object('clock_out', new.clock_out, 'total_hours', new.total_hours));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_time_entries on public.time_entries;
create trigger audit_time_entries
  after insert or update on public.time_entries
  for each row execute function public.fn_audit_time_entries();

create or replace function public.fn_audit_timesheets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and new.status is distinct from old.status
     and new.status in ('approved', 'rejected') then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, old_value, new_value)
    values (auth.uid(),
            case new.status when 'approved' then 'timesheet_approved' else 'timesheet_rejected' end,
            'timesheet', new.id::text,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_timesheets on public.timesheets;
create trigger audit_timesheets
  after update on public.timesheets
  for each row execute function public.fn_audit_timesheets();

create or replace function public.fn_audit_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
    values (auth.uid(), 'task_created', 'task', new.id::text, to_jsonb(new));
  elsif TG_OP = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
    values (auth.uid(), 'task_completed', 'task', new.id::text, jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks
  after insert or update on public.tasks
  for each row execute function public.fn_audit_tasks();

create or replace function public.fn_audit_announcements()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(user_id, action, resource_type, resource_id, new_value)
  values (auth.uid(), 'announcement_created', 'announcement', new.id::text,
          jsonb_build_object('title', new.title, 'target_role', new.target_role));
  return new;
end;
$$;

drop trigger if exists audit_announcements on public.announcements;
create trigger audit_announcements
  after insert on public.announcements
  for each row execute function public.fn_audit_announcements();

-- ----------------------------------------------------------------------------
-- REALTIME — chat needs live message inserts. Guarded so re-running won't error.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ============================================================================
-- DONE. Phase 3 tables, security, audit logging and chat realtime are ready.
-- ============================================================================
