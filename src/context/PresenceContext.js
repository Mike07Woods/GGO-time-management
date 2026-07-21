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

  const offlineIdRef = useRef(null);
  const myStatusIdRef = useRef(null);
  const myUpdatedAtRef = useRef(null); // when I entered my current status
  const statusTypesRef = useRef([]);
  const notifiedOverrunRef = useRef(null); // status-instance already alerted on

  // Keep refs in sync.
  useEffect(() => {
    offlineIdRef.current = statusTypes.find((t) => t.name === 'Offline')?.id || null;
    statusTypesRef.current = statusTypes;
  }, [statusTypes]);

  useEffect(() => {
    const mine = user ? allPresence[user.id] : null;
    myStatusIdRef.current = mine?.status_type_id || null;
    myUpdatedAtRef.current = mine?.updated_at || null;
  }, [allPresence, user]);

  const statusById = useCallback(
    (id) => statusTypes.find((t) => t.id === id) || null,
    [statusTypes]
  );

  // A tab heartbeats every 60s; if we haven't heard from someone in this long
  // (e.g. laptop closed without a clean unload) we show them Offline. Status is
  // otherwise fully manual — we never change it based on mouse/keyboard activity.
  const staleMinutes = 5;

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

      // Preserve an existing disposition across page refreshes. Only set Active
      // when they have no presence row yet or are currently Offline (i.e. coming
      // online fresh) — otherwise just refresh last_active_at so a break/meeting
      // isn't clobbered back to Active on reload.
      const active = types.find((t) => t.name === 'Active');
      const offline = types.find((t) => t.name === 'Offline');
      const { data: mine } = await supabase
        .from('user_presence')
        .select('status_type_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;

      const comingOnline = !mine || !mine.status_type_id || mine.status_type_id === offline?.id;
      const nowIso = new Date().toISOString();
      if (comingOnline && active) {
        await supabase
          .from('user_presence')
          .upsert(
            { user_id: user.id, status_type_id: active.id, last_active_at: nowIso, afk_at: null, updated_at: nowIso },
            { onConflict: 'user_id' }
          );
      } else {
        // Keep their current status; just mark them freshly active (not stale).
        await supabase.from('user_presence').update({ last_active_at: nowIso }).eq('user_id', user.id);
      }
      fetchAllPresence();
    })();

    return () => {
      cancelled = true;
    };
  }, [user, fetchAllPresence]);

  // --- Heartbeat (every 60s): keep my presence fresh + over-limit self-alert.
  //     No auto-AFK — status only changes when the user (or the time clock)
  //     sets it explicitly. ---
  useEffect(() => {
    if (!enabled || !user) return undefined;
    const interval = setInterval(async () => {
      // Keep last_active_at current so an open tab never looks stale, whatever
      // status the user has manually chosen.
      await supabase.from('user_presence').update({ last_active_at: new Date().toISOString() }).eq('user_id', user.id);

      // Disposition time-limit check — notify myself once per status instance if
      // I've stayed in a status past its max_minutes.
      const current = myStatusIdRef.current;
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
  }, [enabled, user]);

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
