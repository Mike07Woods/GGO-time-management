// src/pages/TimeClock.js
// Time clock with GPS stamping and break tracking.
//   Clock in  -> capture GPS, create an 'active' time_entries row
//   Break     -> toggle 'on_break' / 'active' with break_start / break_end
//   Clock out -> capture GPS, compute total_hours, mark 'completed'

import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';

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

export default function TimeClock() {
  const { user } = useAuth();

  const [entry, setEntry] = useState(null); // current open entry (active/on_break)
  const [history, setHistory] = useState([]); // recent completed entries
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

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

  // CLOCK IN — capture GPS then open a new entry.
  async function clockIn() {
    setError('');
    setBusy(true);

    let coords = { lat: null, lng: null };
    try {
      coords = await getPosition();
    } catch (geoErr) {
      // Still allow clocking in, but tell the user the location wasn't captured.
      setError(`Location not captured: ${geoErr.message}`);
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
      setError(error.message);
      return;
    }
    setEntry(data);
  }

  // START BREAK
  async function startBreak() {
    setError('');
    setBusy(true);
    const { data, error } = await supabase
      .from('time_entries')
      .update({ break_start: new Date().toISOString(), status: 'on_break' })
      .eq('id', entry.id)
      .select()
      .single();
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEntry(data);
  }

  // END BREAK
  async function endBreak() {
    setError('');
    setBusy(true);
    const { data, error } = await supabase
      .from('time_entries')
      .update({ break_end: new Date().toISOString(), status: 'active' })
      .eq('id', entry.id)
      .select()
      .single();
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEntry(data);
  }

  // CLOCK OUT — capture GPS, compute total hours (minus any break), complete.
  async function clockOut() {
    setError('');
    setBusy(true);

    let coords = { lat: null, lng: null };
    try {
      coords = await getPosition();
    } catch (geoErr) {
      setError(`Location not captured: ${geoErr.message}`);
    }

    const clockOutAt = new Date();
    const clockInAt = new Date(entry.clock_in);

    // Subtract break duration if a complete break was taken.
    let breakMs = 0;
    if (entry.break_start && entry.break_end) {
      breakMs = new Date(entry.break_end) - new Date(entry.break_start);
    }
    const totalHours = Math.max(0, (clockOutAt - clockInAt - breakMs) / 3600000);

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
      setError(error.message);
      return;
    }
    setEntry(null);
    loadState();
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Time Clock</h1>
          <p>Clock in and out — your location is stamped automatically.</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="grid grid--2">
        {/* Current status / actions */}
        <div className="card">
          <div className="card__title">
            Current Status
            {entry ? (
              <span className={'badge ' + (onBreak ? 'badge--amber' : 'badge--green')}>
                {onBreak ? 'On break' : 'Clocked in'}
              </span>
            ) : (
              <span className="badge badge--gray">Clocked out</span>
            )}
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : entry ? (
            <>
              <div style={{ textAlign: 'center', padding: '10px 0 18px' }}>
                <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {elapsed()}
                </div>
                <div className="dim">since clock-in at {formatTime(entry.clock_in)}</div>
              </div>

              <div className="stack" style={{ marginBottom: 16 }}>
                <div className="row row--between">
                  <span className="muted">Clock-in location</span>
                  <span>{formatCoords(entry.clock_in_lat, entry.clock_in_lng)}</span>
                </div>
                {entry.break_start && (
                  <div className="row row--between">
                    <span className="muted">Break started</span>
                    <span>{formatTime(entry.break_start)}</span>
                  </div>
                )}
              </div>

              <div className="row">
                {onBreak ? (
                  <button className="btn btn--secondary btn--block" disabled={busy} onClick={endBreak}>
                    End break
                  </button>
                ) : (
                  <button className="btn btn--ghost btn--block" disabled={busy} onClick={startBreak}>
                    Start break
                  </button>
                )}
                <button className="btn btn--danger btn--block" disabled={busy} onClick={clockOut}>
                  Clock out
                </button>
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
