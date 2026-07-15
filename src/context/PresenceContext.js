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
  const myUpdatedAtRef = useRef(null); // when I entered my current status
  const statusTypesRef = useRef([]);
  const notifiedOverrunRef = useRef(null); // status-instance already alerted on
  const settingsRef = useRef(settings);

  // Keep refs of the system status ids in sync.
  useEffect(() => {
    const byName = {};
    statusTypes.forEach((t) => (byName[t.name] = t));
    activeIdRef.current = byName['Active']?.id || null;
    afkIdRef.current = byName['AFK']?.id || null;
    offlineIdRef.current = byName['Offline']?.id || null;
    statusTypesRef.current = statusTypes;
  }, [statusTypes]);

  useEffect(() => {
    const mine = user ? allPresence[user.id] : null;
    myStatusIdRef.current = mine?.status_type_id || null;
    myUpdatedAtRef.current = mine?.updated_at || null;
  }, [allPresence, user]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const statusById = useCallback(
    (id) => statusTypes.find((t) => t.id === id) || null,
    [statusTypes]
  );

  // How long after last activity a status is treated as stale -> shown Offline.
  // (Covers laptops closed without a clean tab-close event.)
  const staleMinutes = Math.max(30, (settings.afk_timeout_minutes || 15) * 2);

  const OFFLINE_FALLBACK = { name: 'Offline', color: '#6B7280', emoji: '⚫' };

  // Effective status for a user: the stored status, but downgraded to Offline if
  // no row exists or their last activity is older than the stale threshold.
  const getStatus = useCallback(
    (userId) => {
      const offline = statusTypes.find((t) => t.name === 'Offline') || OFFLINE_FALLBACK;
      const pres = allPresence[userId];
      if (!pres) return offline;
      const st = statusById(pres.status_type_id) || offline;
      if (st.name === 'Offline') return offline;
      const lastMs = new Date(pres.last_active_at || pres.updated_at || 0).getTime();
      if (Date.now() - lastMs > staleMinutes * 60000) return offline;
      return st;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPresence, statusTypes, statusById, staleMinutes]
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

  // Convenience: set my status by its display name (used by the time clock).
  const setMyStatusByName = useCallback(
    async (name, note) => {
      const st = statusTypes.find((t) => t.name === name);
      if (st) await setMyStatus(st.id, note);
    },
    [statusTypes, setMyStatus]
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

      // Disposition time-limit check — notify myself once per status instance if
      // I've stayed in a status past its max_minutes.
      const st = statusTypesRef.current.find((t) => t.id === current);
      const enteredAt = myUpdatedAtRef.current ? new Date(myUpdatedAtRef.current).getTime() : null;
      if (st?.max_minutes && enteredAt && (Date.now() - enteredAt) / 60000 > st.max_minutes) {
        if (notifiedOverrunRef.current !== myUpdatedAtRef.current) {
          notifiedOverrunRef.current = myUpdatedAtRef.current;
          await supabase.from('notifications').insert({
            user_id: user.id,
            title: 'Status time exceeded',
            body: `You've been "${st.name}" for over ${st.max_minutes} minutes.`,
            type: 'status',
          });
        }
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
    getStatus,
    staleMinutes,
    setMyStatus,
    setMyStatusByName,
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
      getStatus: () => ({ name: 'Offline', color: '#6B7280', emoji: '⚫' }),
      staleMinutes: 30,
      setMyStatus: async () => {},
      setMyStatusByName: async () => {},
      refreshSettings: async () => {},
      reloadStatusTypes: async () => {},
      myPresence: null,
    }
  );
}

export default PresenceContext;
