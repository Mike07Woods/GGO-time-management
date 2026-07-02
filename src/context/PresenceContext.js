// src/context/PresenceContext.js
// Global live-presence provider. Mounted once (inside the authenticated shell),
// it upserts the current user's presence, tracks activity to auto-flip Active <->
// AFK, heartbeats, sets Offline on unload, and subscribes to Realtime so every
// component can read live presence via usePresence() with no extra DB calls.
//
// Everything degrades gracefully: if the team-status tables don't exist yet
// (migration not run), the provider quietly no-ops and the app works as before.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';

const PresenceContext = createContext(null);
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

export function PresenceProvider({ children }) {
  const { user } = useAuth();

  const [statusTypes, setStatusTypes] = useState([]);
  const [allPresence, setAllPresence] = useState({}); // user_id -> presence row
  const [settings, setSettings] = useState({
    afk_timeout_minutes: 15,
    ping_cooldown_minutes: 5,
    allow_custom_notes: true,
  });
  const [enabled, setEnabled] = useState(false); // true once the tables are reachable

  const lastActivity = useRef(Date.now());
  const activeIdRef = useRef(null);
  const afkIdRef = useRef(null);
  const offlineIdRef = useRef(null);
  const myStatusIdRef = useRef(null);
  const settingsRef = useRef(settings);

  // Keep refs of the system status ids in sync.
  useEffect(() => {
    const byName = {};
    statusTypes.forEach((t) => (byName[t.name] = t));
    activeIdRef.current = byName['Active']?.id || null;
    afkIdRef.current = byName['AFK']?.id || null;
    offlineIdRef.current = byName['Offline']?.id || null;
  }, [statusTypes]);

  useEffect(() => {
    myStatusIdRef.current = user ? allPresence[user.id]?.status_type_id || null : null;
  }, [allPresence, user]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const statusById = useCallback(
    (id) => statusTypes.find((t) => t.id === id) || null,
    [statusTypes]
  );

  const fetchAllPresence = useCallback(async () => {
    const { data, error } = await supabase.from('user_presence').select('*');
    if (error) return;
    const map = {};
    (data || []).forEach((r) => (map[r.user_id] = r));
    setAllPresence(map);
  }, []);

  const setMyStatus = useCallback(
    async (statusTypeId, note) => {
      if (!user || !statusTypeId) return;
      const now = new Date().toISOString();
      const payload = { user_id: user.id, status_type_id: statusTypeId, last_active_at: now, updated_at: now };
      if (note !== undefined) payload.custom_note = note || null;
      // Optimistic local update.
      setAllPresence((prev) => ({ ...prev, [user.id]: { ...(prev[user.id] || {}), ...payload } }));
      await supabase.from('user_presence').upsert(payload, { onConflict: 'user_id' });
    },
    [user]
  );

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase.from('status_settings').select('*').limit(1).maybeSingle();
    if (data) setSettings(data);
  }, []);

  // --- Init: load status types + settings, set myself Active, load everyone ---
  useEffect(() => {
    if (!user) {
      setEnabled(false);
      return undefined;
    }
    let cancelled = false;

    (async () => {
      const [typesRes, settingsRes] = await Promise.all([
        supabase.from('status_types').select('*').order('sort_order', { ascending: true }),
        supabase.from('status_settings').select('*').limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      if (typesRes.error) {
        setEnabled(false); // migration not run yet — stay quiet
        return;
      }
      const types = typesRes.data || [];
      setStatusTypes(types);
      if (settingsRes.data) setSettings(settingsRes.data);
      setEnabled(true);

      const active = types.find((t) => t.name === 'Active');
      if (active) {
        await supabase
          .from('user_presence')
          .upsert(
            { user_id: user.id, status_type_id: active.id, last_active_at: new Date().toISOString(), afk_at: null, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );
      }
      fetchAllPresence();
    })();

    return () => {
      cancelled = true;
    };
  }, [user, fetchAllPresence]);

  // --- Activity tracking (return from AFK immediately on activity) ---
  useEffect(() => {
    if (!enabled) return undefined;
    const onActivity = () => {
      lastActivity.current = Date.now();
      if (myStatusIdRef.current && myStatusIdRef.current === afkIdRef.current && activeIdRef.current) {
        setMyStatus(activeIdRef.current);
      }
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, [enabled, setMyStatus]);

  // --- Heartbeat + auto-AFK (every 60s) ---
  useEffect(() => {
    if (!enabled || !user) return undefined;
    const interval = setInterval(async () => {
      const active = activeIdRef.current;
      const afk = afkIdRef.current;
      const current = myStatusIdRef.current;
      const idleMin = (Date.now() - lastActivity.current) / 60000;
      const timeout = settingsRef.current.afk_timeout_minutes || 15;

      if (active && afk && current === active && idleMin >= timeout) {
        await setMyStatus(afk);
        await supabase.from('user_presence').update({ afk_at: new Date().toISOString() }).eq('user_id', user.id);
      } else if (current === active) {
        await supabase.from('user_presence').update({ last_active_at: new Date().toISOString() }).eq('user_id', user.id);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [enabled, user, setMyStatus]);

  // --- Realtime: any presence change re-syncs everyone ---
  useEffect(() => {
    if (!enabled || !user) return undefined;
    const channel = supabase
      .channel('presence-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, fetchAllPresence)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [enabled, user, fetchAllPresence]);

  // --- Set Offline on tab close / unmount ---
  useEffect(() => {
    if (!enabled || !user) return undefined;
    const goOffline = () => {
      if (offlineIdRef.current) {
        supabase
          .from('user_presence')
          .update({ status_type_id: offlineIdRef.current, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }
    };
    window.addEventListener('beforeunload', goOffline);
    return () => {
      window.removeEventListener('beforeunload', goOffline);
      goOffline();
    };
  }, [enabled, user]);

  const value = {
    enabled,
    statusTypes,
    allPresence,
    settings,
    statusById,
    setMyStatus,
    refreshSettings,
    reloadStatusTypes: async () => {
      const { data } = await supabase.from('status_types').select('*').order('sort_order', { ascending: true });
      if (data) setStatusTypes(data);
    },
    myPresence: user ? allPresence[user.id] || null : null,
  };

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  // Safe default if used outside the provider (e.g. before login).
  return (
    ctx || {
      enabled: false,
      statusTypes: [],
      allPresence: {},
      settings: { afk_timeout_minutes: 15, ping_cooldown_minutes: 5, allow_custom_notes: true },
      statusById: () => null,
      setMyStatus: async () => {},
      refreshSettings: async () => {},
      reloadStatusTypes: async () => {},
      myPresence: null,
    }
  );
}

export default PresenceContext;
