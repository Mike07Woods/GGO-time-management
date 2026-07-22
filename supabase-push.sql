-- ============================================================================
-- GGO Time Management — PWA Push Notifications
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- Push subscriptions (one per user per device/browser).
create table if not exists public.push_subscriptions (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references public.profiles (id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);
create index if not exists idx_push_subs_user on public.push_subscriptions (user_id);

-- Per-user notification preferences.
create table if not exists public.notification_preferences (
  id                    uuid default gen_random_uuid() primary key,
  user_id               uuid references public.profiles (id) on delete cascade unique,
  -- Everyone
  pings                 boolean default true,
  chat_messages         boolean default true,
  shift_reminders       boolean default true,
  announcements         boolean default true,
  -- Manager+
  employee_clock_events boolean default true,
  afk_alerts            boolean default true,
  timesheet_approvals   boolean default true,
  help_desk_tickets     boolean default true,
  -- Admin+
  all_department_alerts boolean default true,
  new_signups           boolean default true,
  updated_at            timestamptz default now()
);

-- Org-wide default preferences per role (applied when a user's row is created).
create table if not exists public.org_notification_defaults (
  role                  text primary key,   -- 'manager' | 'user' (employee)
  pings                 boolean default true,
  chat_messages         boolean default true,
  shift_reminders       boolean default true,
  announcements         boolean default true,
  employee_clock_events boolean default true,
  afk_alerts            boolean default true,
  timesheet_approvals   boolean default true,
  help_desk_tickets     boolean default true,
  all_department_alerts boolean default true,
  new_signups           boolean default true,
  updated_at            timestamptz default now()
);

insert into public.org_notification_defaults (role)
select r from (values ('manager'), ('user')) as v(r)
where not exists (select 1 from public.org_notification_defaults where role = v.r);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.push_subscriptions       enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.org_notification_defaults enable row level security;

drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notif_prefs_own on public.notification_preferences;
create policy notif_prefs_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notif_prefs_mgr_read on public.notification_preferences;
create policy notif_prefs_mgr_read on public.notification_preferences for select to authenticated
  using (public.is_manager());

-- Everyone can read the org defaults; only owners may change them.
drop policy if exists org_defaults_read on public.org_notification_defaults;
create policy org_defaults_read on public.org_notification_defaults for select to authenticated using (true);

drop policy if exists org_defaults_manage on public.org_notification_defaults;
create policy org_defaults_manage on public.org_notification_defaults for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ============================================================================
-- DONE. Deploy the send-push Edge Function and set VAPID secrets next
-- (see the runbook / README).
-- ============================================================================
