// src/pages/TimeClock.js
// Time clock with GPS stamping and break tracking.
//   Clock in  -> capture GPS, create an 'active' time_entries row
//   Break     -> toggle 'on_break' / 'active' with break_start / break_end
//   Clock out -> capture GPS, compute total_hours, mark 'completed'

import React, { useEffect, useState } from 'react';
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

// Live "how long in this disposition" — e.g. "12m" / "1h 05m".
function durationSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
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

    const open = openRes.data || null;
    setEntry(open);
    setHistory(histRes.data || []);

    // Track any disposition segment still open (presence itself is preserved
    // across refreshes by the PresenceProvider, so no re-assert needed here).
    if (open) {
      const segRes = await supabase
        .from('time_entry_breaks')
        .select('*')
        .eq('time_entry_id', open.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setOpenSeg(segRes.data || null);
    } else {
      setOpenSeg(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (user) loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // CLOCK IN — capture GPS then open a new entry.
  async function clockIn() {
    setBusy(true);

    let coords = { lat: null, lng: null };
    try {
      coords = await getPosition();
    } catch (geoErr) {
      // Still allow clocking in, but tell the user the location wasn't captured.
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

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEntry(data);
    setMyStatusByName('Active');
    // Start logging the shift's disposition timeline (begins as Active).
    const { data: seg } = await supabase
      .from('time_entry_breaks')
      .insert({ time_entry_id: data.id, user_id: user.id, kind: 'Active', started_at: new Date().toISOString() })
      .select()
      .single();
    setOpenSeg(seg || null);
    toast.success('Clocked in');
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

  // Set the current disposition (Active / On Break / AFK / Meeting / …). Every
  // change is logged as a segment in time_entry_breaks, so the whole shift is a
  // complete timeline of what happened — the app records, HR decides what counts.
  async function setDisposition(name) {
    if (!entry || busy) return;
    setBusy(true);
    const isNoteStatus = NOTE_STATUSES.includes(name.toLowerCase());

    await setMyStatusByName(name, isNoteStatus ? note : '');

    let seg = openSeg;
    // Close the current segment and open one for the new disposition.
    if (seg && seg.kind !== name) {
      await supabase
        .from('time_entry_breaks')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', seg.id);
      seg = null;
    }
    if (!seg) {
      const { data } = await supabase
        .from('time_entry_breaks')
        .insert({ time_entry_id: entry.id, user_id: user.id, kind: name, started_at: new Date().toISOString() })
        .select()
        .single();
      seg = data || null;
    }
    setOpenSeg(seg);
    setBusy(false);
  }

  // Save the note for the current meeting/coaching disposition.
  function saveNote() {
    const cur = myPresence ? statusById(myPresence.status_type_id) : null;
    if (cur) setMyStatusByName(cur.name, note);
  }

  // CLOCK OUT — capture GPS, compute total hours (minus any break), complete.
  async function clockOut() {
    setBusy(true);

    let coords = { lat: null, lng: null };
    try {
      coords = await getPosition();
    } catch (geoErr) {
      toast.info(`Location not captured: ${geoErr.message}`);
    }

    const clockOutAt = new Date();

    // Close the open disposition segment at clock-out time.
    if (openSeg) {
      await supabase
        .from('time_entry_breaks')
        .update({ ended_at: clockOutAt.toISOString() })
        .eq('id', openSeg.id);
    }

    // total_hours = the full on-clock time (gross). We record the disposition
    // breakdown separately; how much is paid is left to HR.
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

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEntry(null);
    setOpenSeg(null);
    setMyStatusByName('Offline');
    loadState();
    toast.success(`Clocked out — ${totalHours.toFixed(2)} h logged`);
  }

  // Live elapsed time since clock-in (HH:MM:SS).
  function elapsed() {
    if (!entry?.clock_in) return '00:00:00';
    const ms = now - new Date(entry.clock_in).getTime();
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

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
              {/* Shift timer */}
              <div style={{ textAlign: 'center', padding: '6px 0 12px' }}>
                <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {elapsed()}
                </div>
                <div className="dim">since clock-in at {formatTime(entry.clock_in)}</div>
              </div>

              {/* Current disposition + live duration */}
              {currentDisp && (
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <span style={{ color: currentDisp.color, fontWeight: 700 }}>
                    {currentDisp.emoji} {currentDisp.name}
                  </span>
                  {myPresence?.updated_at && (
                    <span className="dim"> · for {durationSince(myPresence.updated_at)}</span>
                  )}
                </div>
              )}

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

        {/* Recent history */}
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
  );
}
