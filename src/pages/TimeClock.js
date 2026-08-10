// src/pages/TimeClock.js
// Time clock with GPS stamping and break tracking.
//   Clock in  -> capture GPS, create an 'active' time_entries row
//   Break     -> toggle 'on_break' / 'active' with break_start / break_end
//   Clock out -> capture GPS, compute total_hours, mark 'completed'

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { usePresence } from '../context/PresenceContext';
import { Clock } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

// Promisified geolocation lookup. Resolves to { lat, lng } or rejects with a message.
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message || 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Pretty-print coordinates, or a dash.
function formatCoords(lat, lng) {
  if (lat == null || lng == null) return '—';
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

// Dispositions that prompt for a note (what the meeting/coaching is about).
const NOTE_STATUSES = ['in meeting', 'coaching'];

// Just the time (e.g. 9:03 AM).
function hmTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
// Duration of a segment (ongoing runs to nowMs).
function durMin(seg, nowMs) {
  const end = seg.ended_at ? new Date(seg.ended_at).getTime() : nowMs;
  const m = Math.max(0, Math.round((end - new Date(seg.started_at).getTime()) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export default function TimeClock() {
  const { user } = useAuth();
  const toast = useToast();
  // Dispositions ARE the on-shift controls: clock-in -> Active, then the user
  // sets Break / AFK / Meeting / etc.; clock-out -> Offline.
  const {
    enabled: presenceEnabled,
    statusTypes,
    myPresence,
    statusById,
    setMyStatusByName,
  } = usePresence();

  const [entry, setEntry] = useState(null); // current open entry (active/on_break)
  const [history, setHistory] = useState([]); // recent completed entries
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState(''); // note for meeting/coaching dispositions
  const [openSeg, setOpenSeg] = useState(null); // current open unpaid break/afk segment
  const [todaySegs, setTodaySegs] = useState([]); // my disposition segments today

  // My disposition timeline for today (most recent first).
  const loadToday = useCallback(async () => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('time_entry_breaks')
      .select('id, kind, started_at, ended_at')
      .eq('user_id', user.id)
      .gte('started_at', dayStart.toISOString())
      .order('started_at', { ascending: false });
    setTodaySegs(data || []);
  }, [user.id]);

  // Refresh the timeline when the shift changes (clock in/out).
  useEffect(() => {
    loadToday();
  }, [loadToday, entry]);

  // The current open segment is derived from today's timeline (a single source
  // of truth managed by the database) — used for the disposition timer.
  useEffect(() => {
    setOpenSeg(todaySegs.find((s) => !s.ended_at) || null);
  }, [todaySegs]);

  // Keep the note field in sync with the server value.
  useEffect(() => {
    setNote(myPresence?.custom_note || '');
  }, [myPresence]);

  // Tick every second so the elapsed timer updates live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function loadState() {
    setLoading(true);

    const [openRes, histRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['active', 'on_break'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('clock_in', { ascending: false })
        .limit(10),
    ]);

    setEntry(openRes.data || null);
    setHistory(histRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (user) loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // CLOCK IN — capture GPS then open a new entry. The DB trigger opens the first
  // (Active) disposition segment automatically.
  async function clockIn() {
    if (busy) return;
    setBusy(true);
    try {
      let coords = { lat: null, lng: null };
      try {
        coords = await getPosition();
      } catch (geoErr) {
        toast.info(`Location not captured: ${geoErr.message}`);
      }

      const { data, error } = await supabase
        .from('time_entries')
        .insert({
          user_id: user.id,
          clock_in: new Date().toISOString(),
          clock_in_lat: coords.lat,
          clock_in_lng: coords.lng,
          status: 'active',
        })
        .select()
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      setEntry(data);
      await setMyStatusByName('Active');
      await loadToday();
      toast.success('Clocked in');
    } finally {
      setBusy(false);
    }
  }

  // START BREAK
  async function startBreak() {
    setBusy(true);
    const { data, error } = await supabase
      .from('time_entries')
      .update({ break_start: new Date().toISOString(), status: 'on_break' })
      .eq('id', entry.id)
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEntry(data);
    setMyStatusByName('On Break');
    toast.info('Break started');
  }

  // END BREAK
  async function endBreak() {
    setBusy(true);
    const { data, error } = await supabase
      .from('time_entries')
      .update({ break_end: new Date().toISOString(), status: 'active' })
      .eq('id', entry.id)
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEntry(data);
    setMyStatusByName('Active');
    toast.success('Break ended');
  }

  // Set the current disposition. Just changes presence — a DB trigger atomically
  // closes the prior segment and opens the new one (no client-side races), so the
  // timeline stays consistent no matter how fast the user switches.
  async function setDisposition(name) {
    if (!entry || busy) return;
    setBusy(true);
    try {
      const isNoteStatus = NOTE_STATUSES.includes(name.toLowerCase());
      await setMyStatusByName(name, isNoteStatus ? note : '');
      await loadToday();
    } finally {
      setBusy(false);
    }
  }

  // Save the note for the current meeting/coaching disposition.
  function saveNote() {
    const cur = myPresence ? statusById(myPresence.status_type_id) : null;
    if (cur) setMyStatusByName(cur.name, note);
  }

  // CLOCK OUT — capture GPS, record gross hours, complete. Completing the entry
  // fires a DB trigger that closes any open disposition segment.
  async function clockOut() {
    if (busy) return;
    setBusy(true);
    try {
      let coords = { lat: null, lng: null };
      try {
        coords = await getPosition();
      } catch (geoErr) {
        toast.info(`Location not captured: ${geoErr.message}`);
      }

      const clockOutAt = new Date();
      const totalHours = Math.max(0, (clockOutAt.getTime() - new Date(entry.clock_in).getTime()) / 3600000);

      const { error } = await supabase
        .from('time_entries')
        .update({
          clock_out: clockOutAt.toISOString(),
          clock_out_lat: coords.lat,
          clock_out_lng: coords.lng,
          total_hours: Number(totalHours.toFixed(2)),
          status: 'completed',
        })
        .eq('id', entry.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      setEntry(null);
      await setMyStatusByName('Offline');
      await loadState();
      await loadToday();
      toast.success(`Clocked out — ${totalHours.toFixed(2)} h logged`);
    } finally {
      setBusy(false);
    }
  }

  // Live elapsed time since clock-in (HH:MM:SS).
  function hms(fromIso) {
    if (!fromIso) return '00:00:00';
    const total = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  // Total shift time since clock-in.
  const elapsed = () => hms(entry?.clock_in);
  // Time in the CURRENT disposition (resets each time they switch). Uses the
  // open segment's start so it survives refreshes.
  const dispElapsed = () => hms(openSeg?.started_at || entry?.clock_in);

  const onBreak = entry?.status === 'on_break';
  const currentDisp = presenceEnabled && myPresence ? statusById(myPresence.status_type_id) : null;
  const dispositions = statusTypes.filter((s) => s.name !== 'Offline');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1><Clock size={20} /> Time Clock</h1>
          <p>Clock in and out — your location is stamped automatically.</p>
        </div>
      </div>

      <div className="grid grid--2">
        {/* Current status / actions */}
        <div className="card">
          <div className="card__title">
            Current Status
            {entry ? (
              <span className="badge badge--green">Clocked in</span>
            ) : (
              <span className="badge badge--gray">Clocked out</span>
            )}
          </div>

          {loading ? (
            <SkeletonList rows={2} />
          ) : entry ? (
            <>
              {/* Current-disposition timer (resets each time they switch) */}
              <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
                {currentDisp && (
                  <div style={{ fontWeight: 700, color: currentDisp.color, marginBottom: 2 }}>
                    {currentDisp.emoji} {currentDisp.name}
                  </div>
                )}
                <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {dispElapsed()}
                </div>
                <div className="dim" style={{ fontSize: 12 }}>on this disposition</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  Shift total {elapsed()} · since {formatTime(entry.clock_in)}
                </div>
              </div>

              {/* Disposition controls (fallback to a simple break toggle if
                  live presence isn't set up yet) */}
              {presenceEnabled && dispositions.length > 0 ? (
                <>
                  <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
                    Set your disposition
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {dispositions.map((s) => {
                      const active = currentDisp?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          className={'btn btn--sm ' + (active ? 'btn--primary' : 'btn--ghost')}
                          disabled={busy}
                          onClick={() => setDisposition(s.name)}
                        >
                          {s.emoji} {s.name}
                        </button>
                      );
                    })}
                  </div>
                  {currentDisp && NOTE_STATUSES.includes(currentDisp.name.toLowerCase()) && (
                    <div className="field" style={{ marginBottom: 12 }}>
                      <input
                        className="input"
                        placeholder={`Note for this ${currentDisp.name.toLowerCase()}…`}
                        maxLength={80}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onBlur={saveNote}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            saveNote();
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="row" style={{ marginBottom: 12 }}>
                  {onBreak ? (
                    <button className="btn btn--secondary btn--block" disabled={busy} onClick={endBreak}>
                      End break
                    </button>
                  ) : (
                    <button className="btn btn--ghost btn--block" disabled={busy} onClick={startBreak}>
                      Start break
                    </button>
                  )}
                </div>
              )}

              <button className="btn btn--danger btn--block" disabled={busy} onClick={clockOut}>
                Clock out
              </button>

              {/* Details */}
              <div className="stack" style={{ marginTop: 16 }}>
                <div className="row row--between">
                  <span className="muted">Clock-in location</span>
                  <span>{formatCoords(entry.clock_in_lat, entry.clock_in_lng)}</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '14px 0' }}>
              <p className="muted">You are currently clocked out.</p>
              <button className="btn btn--primary btn--block" disabled={busy} onClick={clockIn}>
                {busy ? 'Capturing location…' : '⏱️  Clock in'}
              </button>
            </div>
          )}
        </div>

        {/* Right column: today's disposition timeline + recent entries */}
        <div className="stack">
          <div className="card">
            <div className="card__title">Today’s Timeline</div>
            {todaySegs.length === 0 ? (
              <div className="empty-state">No activity yet today.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Disposition</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todaySegs.map((s) => {
                      const em = statusTypes.find((t) => t.name === s.kind)?.emoji || '';
                      return (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>
                            {em} {s.kind}
                          </td>
                          <td>{hmTime(s.started_at)}</td>
                          <td>{s.ended_at ? hmTime(s.ended_at) : <span className="badge badge--green">now</span>}</td>
                          <td>{durMin(s, now)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__title">Recent Entries</div>
            {history.length === 0 ? (
              <div className="empty-state">No completed entries yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Clock in</th>
                      <th>Clock out</th>
                      <th>Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td>{formatTime(h.clock_in)}</td>
                        <td>{formatTime(h.clock_out)}</td>
                        <td>{h.total_hours != null ? `${h.total_hours}h` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
