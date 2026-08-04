-- ============================================================================
-- GGO Time Management — Server-side push triggers
-- Sends push to managers for clock in/out and disposition-overrun (AFK) alerts,
-- even when no one has the app open. Uses pg_net to call the send-push Edge
-- Function. Run AFTER supabase-push.sql and supabase-team-status.sql.
--
-- ONE-TIME SETUP (run these two lines yourself, with your real service_role key;
-- do NOT commit them). The URL line is optional — it falls back to the literal
-- in fn_send_push below:
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
--   select vault.create_secret('https://zzzvipczkcwxaselnawv.supabase.co', 'project_url');
-- ============================================================================

create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Helper: fire a push via the send-push Edge Function (async, best-effort).
-- Reads the service_role key (and optional project URL) from Supabase Vault so
-- no secret is stored in this file.
-- ----------------------------------------------------------------------------
create or replace function public.fn_send_push(payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  -- Fall back to the known project URL if the secret isn't set (ref is not secret).
  v_url := coalesce(v_url, 'https://zzzvipczkcwxaselnawv.supabase.co');
  if v_key is null then
    return; -- service_role_key not configured — skip quietly
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := payload
  );
end;
$$;

-- Only triggers (running as the owner) should call this — not end users.
revoke all on function public.fn_send_push(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Clock in / out -> notify admins/owners + same-department managers.
-- ----------------------------------------------------------------------------
create or replace function public.fn_push_clock_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event text;
  v_name  text;
  v_dept  text;
  v_dept_id uuid;
  v_recipients uuid[];
  v_time text;
begin
  if tg_op = 'INSERT' then
    v_event := 'in';
  elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    v_event := 'out';
  else
    return new;
  end if;

  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email),
         department_id
    into v_name, v_dept_id
    from public.profiles where id = new.user_id;

  select name into v_dept from public.departments where id = v_dept_id;

  select array_agg(id) into v_recipients
    from public.profiles
   where is_active = true
     and id <> new.user_id
     and (role in ('admin', 'owner') or (role = 'manager' and department_id is not distinct from v_dept_id));

  if v_recipients is null then
    return new;
  end if;

  v_time := to_char(now(), 'HH24:MI'); -- server time (UTC on Supabase)

  perform public.fn_send_push(jsonb_build_object(
    'user_ids', to_jsonb(v_recipients),
    'title', coalesce(v_name, 'Someone') || ' clocked ' || v_event,
    'body', 'At ' || v_time || case when v_dept is not null then ' — ' || v_dept else '' end,
    'url', '/team-status',
    'tag', 'clock-' || new.user_id::text,
    'pref', 'employee_clock_events'
  ));
  return new;
end;
$$;

drop trigger if exists push_clock_event on public.time_entries;
create trigger push_clock_event after insert or update on public.time_entries
  for each row execute function public.fn_push_clock_event();

-- ----------------------------------------------------------------------------
-- Disposition-overrun (AFK) alerts. fn_check_disposition_overruns already
-- inserts one notification per manager (type 'status_overrun'); mirror each to a
-- push. Decoupled here so we don't have to touch that function.
-- ----------------------------------------------------------------------------
create or replace function public.fn_push_from_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'status_overrun' then
    perform public.fn_send_push(jsonb_build_object(
      'user_ids', jsonb_build_array(new.user_id),
      'title', coalesce(new.title, 'Disposition alert'),
      'body', coalesce(new.body, ''),
      'url', '/team-status',
      'tag', 'overrun',
      'pref', 'afk_alerts'
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists push_from_notification on public.notifications;
create trigger push_from_notification after insert on public.notifications
  for each row execute function public.fn_push_from_notification();

-- ============================================================================
-- DONE. Clock in/out + AFK-overrun pushes now fire server-side.
-- ============================================================================
