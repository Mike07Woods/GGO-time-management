-- ============================================================================
-- GGO Time Management — Presence Realtime egress/message fix
-- Removes user_presence (and the unused status_pings) from the Realtime
-- publication. The 60s heartbeat no longer broadcasts to every client; instead
-- the app delivers disposition changes via a lightweight Realtime BROADCAST and
-- polls presence once a minute for stale/offline detection. Run once; safe to
-- re-run. No feature/UI change — only how presence traffic flows.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_presence'
  ) then
    alter publication supabase_realtime drop table public.user_presence;
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'status_pings'
  ) then
    alter publication supabase_realtime drop table public.status_pings;
  end if;
end $$;

-- Kept in the publication (genuinely need live updates):
--   chat_messages, notifications
-- ============================================================================
