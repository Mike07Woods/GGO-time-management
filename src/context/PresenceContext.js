// src/context/PresenceContext.js
// Global live-presence provider. Mounted once (inside the authenticated shell),
// it upserts the current user's presence, tracks activity to auto-flip Active <->
// AFK, heartbeats, sets Offline on unload, and subscribes to Realtime so every
// component can read live presence via usePresence() with no extra DB calls.
//
// Everything degrades gracefully: if the team-status tables don't exist yet
// (migration not run), the provider quietly no-ops and the app works as before.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';

const PresenceContext = createContext(null);

export function PresenceProvider({ children }) {
  const { user } = useAuth();
  // Key every effect on the user's ID, not the `user` object: AuthContext hands
  // out a NEW object on every auth event (token refresh, tab refocus), which used
  // to re-run the whole setup below and could reset a Break/Meeting back to Active.
  const userId = user?.id || null;

  const [statusTypes, setStatusTypes] = useState([]);
  const [allPresence, setAllPresence] = useState({}); // user_id -> presence row
  const [settings, setSettings] = useState({
    afk_timeout_minutes: 15,
    ping_cooldown_minutes: 5,
    allow_custom_notes: true,
  });
  const [enabled, setEnabled] = useState(false); // true once the tables are reachable

  const myStatusIdRef = useRef(null);
  const myUpdatedAtRef = useRef(null); // when I entered my current status
  const statusTypesRef = useRef([]);
  const notifiedOverrunRef = useRef(null); // status-instance already alerted on
  const broadcastRef = useRef(null); // realtime broadcast channel for status changes

  // Keep refs in sync.
  useEffect(() => {
    statusTypesRef.current = statusTypes;
  }, [statusTypes]);

  useEffect(() => {
    const mine = userId ? allPresence[userId] : null;
    myStatusIdRef.current = mine?.status_type_id || null;
    myUpdatedAtRef.current = mine?.updated_at || null;
  }, [allPresence, userId]);

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
    // Explicit columns only (no select('*')) — presence is small and polled.
    const { data, error } = await supabase
      .from('user_presence')
      .select('user_id, status_type_id, custom_note, last_active_at, afk_at, updated_at');
    if (error) return;
    const map = {};
    (data || []).forEach((r) => (map[r.user_id] = r));
    setAllPresence(map);
  }, []);

  // Just MY row — all most people need. Merges into state instead of replacing it.
  const fetchMyPresence = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('user_presence')
      .select('user_id, status_type_id, custom_note, last_active_at, afk_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return;
    setAllPresence((prev) => ({ ...prev, [userId]: data }));
  }, [userId]);

  // Other people's presence is only polled while something on screen shows it
  // (Team Status, Directory, dot next to someone else's avatar...). Those
  // components call watchOthers() on mount; it returns the cleanup. With ~50
  // people online, polling the whole table for everyone cost ~50 x 95 rows/minute
  // even for people looking at pages that never show it.
  const [watchers, setWatchers] = useState(0);
  const watchOthers = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => Math.max(0, n - 1));
  }, []);
  const watching = watchers > 0;

  const setMyStatus = useCallback(
    async (statusTypeId, note) => {
      if (!userId || !statusTypeId) return;
      const now = new Date().toISOString();
      const unchanged = myStatusIdRef.current === statusTypeId;
      // Same status and nothing new to say -> nothing to do (don't restart the timer).
      if (unchanged && note === undefined) return;
      const payload = { user_id: userId, status_type_id: statusTypeId, last_active_at: now };
      // `updated_at` marks when the CURRENT status began, so only a real change
      // moves it. Saving a note on the same status must not reset "for X min" or
      // the over-limit timer.
      if (!unchanged) payload.updated_at = now;
      if (note !== undefined) payload.custom_note = note || null;
      // Optimistic local update.
      setAllPresence((prev) => ({ ...prev, [userId]: { ...(prev[userId] || {}), ...payload } }));
      await supabase.from('user_presence').upsert(payload, { onConflict: 'user_id' });
      // Broadcast the change so other clients update instantly (no full refetch).
      broadcastRef.current?.send({ type: 'broadcast', event: 'status', payload });
    },
    [userId]
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
    if (!userId) {
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

      // Preserve an existing disposition across a QUICK refresh, but if the last
      // activity is stale (they closed the app and came back later), treat it as
      // coming online fresh -> Active. This stops a stale break/meeting from
      // surviving for hours and then wrongly tripping the over-limit alert.
      const active = types.find((t) => t.name === 'Active');
      const offline = types.find((t) => t.name === 'Offline');
      const { data: mine } = await supabase
        .from('user_presence')
        .select('status_type_id, last_active_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;

      const lastActiveMs = mine?.last_active_at ? new Date(mine.last_active_at).getTime() : 0;
      const isStale = Date.now() - lastActiveMs > staleMinutes * 60000;
      const comingOnline = !mine || !mine.status_type_id || mine.status_type_id === offline?.id || isStale;
      const nowIso = new Date().toISOString();
      if (comingOnline && active) {
        await supabase
          .from('user_presence')
          .upsert(
            { user_id: userId, status_type_id: active.id, last_active_at: nowIso, afk_at: null, updated_at: nowIso },
            { onConflict: 'user_id' }
          );
      } else {
        // Keep their current status; just mark them freshly active (not stale).
        await supabase.from('user_presence').update({ last_active_at: nowIso }).eq('user_id', userId);
      }
      fetchMyPresence();
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, fetchMyPresence]);

  // --- Poll everyone's presence, but only while someone is watching, and only
  //     while the tab is visible. Refreshes last_active_at for stale/offline
  //     detection and reconciles any missed broadcast. ---
  useEffect(() => {
    if (!enabled || !userId || !watching) return undefined;
    const poll = () => {
      if (document.visibilityState === 'visible') fetchAllPresence();
    };
    poll();
    const interval = setInterval(poll, 60000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [enabled, userId, watching, fetchAllPresence]);

  // --- Heartbeat (every 60s): keep my presence fresh + over-limit self-alert.
  //     No auto-AFK — status only changes when the user (or the time clock)
  //     sets it explicitly. ---
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const beat = async () => {
      // Keep last_active_at current so an open tab never looks stale, whatever
      // status the user has manually chosen.
      await supabase.from('user_presence').update({ last_active_at: new Date().toISOString() }).eq('user_id', userId);

      // Re-read just my own row (catches a change made on another device).
      // Everyone else's presence is polled separately, only while watched.
      fetchMyPresence();

      // Disposition time-limit check — notify myself once per status instance if
      // I've stayed in a status past its max_minutes.
      const current = myStatusIdRef.current;
      const st = statusTypesRef.current.find((t) => t.id === current);
      const enteredAt = myUpdatedAtRef.current ? new Date(myUpdatedAtRef.current).getTime() : null;
      if (st?.max_minutes && enteredAt && (Date.now() - enteredAt) / 60000 > st.max_minutes) {
        if (notifiedOverrunRef.current !== myUpdatedAtRef.current) {
          notifiedOverrunRef.current = myUpdatedAtRef.current;
          await supabase.from('notifications').insert({
            user_id: userId,
            title: 'Status time exceeded',
            body: `You've been "${st.name}" for over ${st.max_minutes} minutes.`,
            type: 'status',
          });
        }
      }
    };
    const interval = setInterval(beat, 60000);
    // Browsers throttle or freeze background tabs, which used to leave people
    // showing Offline for up to a minute after coming back. Beat right away when
    // the tab becomes visible again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, userId, fetchMyPresence]);

  // --- Realtime: disposition changes arrive as lightweight BROADCASTs (instant)
  //     and are patched into state. Heartbeats are NOT broadcast (user_presence
  //     is removed from the realtime publication), so there's no N-squared
  //     fan-out and no full-table refetch on every change. ---
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const channel = supabase.channel('presence-status', { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        if (!payload?.user_id) return;
        setAllPresence((prev) => ({
          ...prev,
          [payload.user_id]: { ...(prev[payload.user_id] || {}), ...payload },
        }));
      })
      .subscribe();
    broadcastRef.current = channel;
    return () => {
      broadcastRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [enabled, userId]);

  // NOTE: we deliberately do NOT write "Offline" on tab close / unmount. That
  // handler also fired on a normal refresh (beforeunload), so a user on Break
  // would be flipped to Offline and then back to Active by the next mount. A
  // closed tab now simply stops heartbeating and getStatus() shows it Offline
  // after `staleMinutes`; clock-out still sets Offline explicitly.

  const reloadStatusTypes = useCallback(async () => {
    const { data } = await supabase.from('status_types').select('*').order('sort_order', { ascending: true });
    if (data) setStatusTypes(data);
  }, []);

  // Memoized so consumers only re-render when something they read actually changes.
  const myPresence = userId ? allPresence[userId] || null : null;
  const value = useMemo(
    () => ({
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
      reloadStatusTypes,
      watchOthers,
      myPresence,
    }),
    [
      watchOthers,
      enabled,
      statusTypes,
      allPresence,
      settings,
      statusById,
      getStatus,
      setMyStatus,
      setMyStatusByName,
      refreshSettings,
      reloadStatusTypes,
      myPresence,
    ]
  );

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
      watchOthers: () => () => {},
      myPresence: null,
    }
  );
}

// Call from any component that shows OTHER people's presence. While at least one
// such component is mounted (and `active`), the provider keeps their presence fresh.
export function useWatchPresence(active = true) {
  const { watchOthers } = usePresence();
  useEffect(() => (active ? watchOthers() : undefined), [watchOthers, active]);
}

export default PresenceContext;
