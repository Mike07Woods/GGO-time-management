// src/pages/Reports.js
// Phase 2 — Reporting & analytics (owner/admin only).
// Date-range summaries for attendance, timesheet approvals, task completion and
// overtime, with CSV export. The /reports route is admin-gated in App.js; this
// page also reads role-scoped data so non-admins would simply see nothing.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
}

function clockTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dateFmt(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMins(mins) {
  if (!mins) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// Preferred column order for the disposition breakdown.
const ATT_ORDER = ['Active', 'On Break', 'AFK', 'In Meeting', 'On Call', 'Coaching'];

function downloadCsv(filename, rows) {
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  // Default range: the last 7 days.
  const today = useMemo(() => new Date(), []);
  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d;
  }, []);

  const [start, setStart] = useState(ymd(weekAgo));
  const [end, setEnd] = useState(ymd(today));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [attendance, setAttendance] = useState([]); // [{id,name,hours,entries}]
  const [tsCounts, setTsCounts] = useState({ submitted: 0, approved: 0, rejected: 0, draft: 0 });
  const [taskStats, setTaskStats] = useState({ total: 0, completed: 0 });
  const [threshold, setThreshold] = useState(40);

  // Daily clock in/out attendance (its own single-date picker).
  const [attDate, setAttDate] = useState(ymd(new Date()));
  const [attRows, setAttRows] = useState([]);
  const [attLoading, setAttLoading] = useState(true);

  // Attendance log across the top date range (one row per clock-in).
  const [logRows, setLogRows] = useState([]);
  const [logLoading, setLogLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    const startIso = new Date(`${start}T00:00:00`).toISOString();
    const endExclusive = new Date(`${end}T00:00:00`);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const endIso = endExclusive.toISOString();

    const [peopleRes, entriesRes, tsRes, tasksRes, ruleRes] = await Promise.all([
      supabase.from('profiles').select('id, first_name, last_name, email').eq('is_active', true),
      supabase
        .from('time_entries')
        .select('user_id, total_hours, status')
        .gte('clock_in', startIso)
        .lt('clock_in', endIso),
      supabase.from('timesheets').select('status').gte('week_start', start).lte('week_start', end),
      supabase.from('tasks').select('status').gte('created_at', startIso).lt('created_at', endIso),
      supabase
        .from('overtime_rules')
        .select('weekly_threshold')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
    ]);

    if (entriesRes.error) setError(entriesRes.error.message);

    // Attendance: hours + completed entry count per employee.
    const byUser = {};
    (entriesRes.data || []).forEach((e) => {
      if (e.status !== 'completed' || e.total_hours == null) return;
      byUser[e.user_id] = byUser[e.user_id] || { hours: 0, entries: 0 };
      byUser[e.user_id].hours += Number(e.total_hours);
      byUser[e.user_id].entries += 1;
    });
    const rows = (peopleRes.data || [])
      .map((p) => ({
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
        hours: byUser[p.id]?.hours || 0,
        entries: byUser[p.id]?.entries || 0,
      }))
      .sort((a, b) => b.hours - a.hours);
    setAttendance(rows);

    // Timesheet status counts.
    const counts = { submitted: 0, approved: 0, rejected: 0, draft: 0 };
    (tsRes.data || []).forEach((t) => {
      if (counts[t.status] != null) counts[t.status] += 1;
    });
    setTsCounts(counts);

    // Task completion.
    const allTasks = tasksRes.data || [];
    setTaskStats({
      total: allTasks.length,
      completed: allTasks.filter((t) => t.status === 'completed').length,
    });

    if (ruleRes.data?.weekly_threshold != null) setThreshold(Number(ruleRes.data.weekly_threshold));

    setLoading(false);
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load]);

  // Load a single day's clock in/out per employee.
  useEffect(() => {
    let active = true;
    (async () => {
      setAttLoading(true);
      const dayStart = new Date(`${attDate}T00:00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const [peopleRes, entriesRes, segRes] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, email'),
        supabase
          .from('time_entries')
          .select('user_id, clock_in, clock_out, total_hours, status')
          .gte('clock_in', dayStart.toISOString())
          .lt('clock_in', dayEnd.toISOString()),
        // Disposition timeline segments for the day (breaks, afk, meetings, …).
        supabase
          .from('time_entry_breaks')
          .select('user_id, kind, started_at, ended_at')
          .gte('started_at', dayStart.toISOString())
          .lt('started_at', dayEnd.toISOString()),
      ]);
      if (!active) return;

      const nameById = {};
      (peopleRes.data || []).forEach((p) => {
        nameById[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
      });

      // Minutes per disposition per user, from the segment log.
      const now = Date.now();
      const segMins = {};
      (segRes.data || []).forEach((s) => {
        const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
        const mins = Math.max(0, (end - new Date(s.started_at).getTime()) / 60000);
        segMins[s.user_id] = segMins[s.user_id] || {};
        segMins[s.user_id][s.kind] = (segMins[s.user_id][s.kind] || 0) + mins;
      });

      const byUser = {};
      (entriesRes.data || []).forEach((e) => {
        const cur = byUser[e.user_id] || {
          firstIn: null,
          firstInMs: Infinity,
          lastOut: null,
          lastOutMs: 0,
          hours: 0,
          open: false,
        };
        const inMs = new Date(e.clock_in).getTime();
        if (inMs < cur.firstInMs) {
          cur.firstInMs = inMs;
          cur.firstIn = e.clock_in;
        }
        if (e.status !== 'completed') cur.open = true;
        if (e.clock_out) {
          const outMs = new Date(e.clock_out).getTime();
          if (outMs > cur.lastOutMs) {
            cur.lastOutMs = outMs;
            cur.lastOut = e.clock_out;
          }
        }
        if (e.total_hours != null) cur.hours += Number(e.total_hours);
        byUser[e.user_id] = cur;
      });

      const rows = Object.entries(byUser)
        .map(([id, v]) => ({ id, name: nameById[id] || 'Unknown', mins: segMins[id] || {}, ...v }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setAttRows(rows);
      setAttLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [attDate]);

  // Disposition columns present in the day's data (ordered).
  const attKinds = useMemo(() => {
    const set = new Set();
    attRows.forEach((r) => Object.keys(r.mins || {}).forEach((k) => set.add(k)));
    return Array.from(set).sort((a, b) => {
      const ia = ATT_ORDER.indexOf(a);
      const ib = ATT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [attRows]);

  function exportAttendanceDay() {
    const header = ['Employee', 'Clock in', 'Clock out', 'Total hours', ...attKinds, 'Status'];
    const body = attRows.map((r) => [
      r.name,
      clockTime(r.firstIn),
      r.open ? 'Still in' : clockTime(r.lastOut),
      r.hours.toFixed(2),
      ...attKinds.map((k) => (r.mins?.[k] ? Math.round(r.mins[k]) : 0)),
      r.open ? 'Clocked in' : 'Completed',
    ]);
    downloadCsv(`attendance_${attDate}.csv`, [header, ...body]);
  }

  // Load one row per clock-in across the top [start, end] range.
  useEffect(() => {
    let active = true;
    (async () => {
      setLogLoading(true);
      const startIso = new Date(`${start}T00:00:00`).toISOString();
      const endEx = new Date(`${end}T00:00:00`);
      endEx.setDate(endEx.getDate() + 1);

      const [peopleRes, entriesRes] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, email'),
        supabase
          .from('time_entries')
          .select('id, user_id, clock_in, clock_out, total_hours, status')
          .gte('clock_in', startIso)
          .lt('clock_in', endEx.toISOString())
          .order('clock_in', { ascending: false }),
      ]);
      if (!active) return;

      const nameById = {};
      (peopleRes.data || []).forEach((p) => {
        nameById[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
      });
      setLogRows(
        (entriesRes.data || []).map((e) => ({
          id: e.id,
          name: nameById[e.user_id] || 'Unknown',
          clockIn: e.clock_in,
          clockOut: e.clock_out,
          hours: e.total_hours,
          status: e.status,
        }))
      );
      setLogLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [start, end]);

  function exportLog() {
    const header = ['Employee', 'Date', 'Clock in', 'Clock out', 'Hours', 'Status'];
    const body = logRows.map((r) => [
      r.name,
      dateFmt(r.clockIn),
      clockTime(r.clockIn),
      r.clockOut ? clockTime(r.clockOut) : 'Still in',
      r.hours != null ? Number(r.hours).toFixed(2) : '',
      r.status,
    ]);
    downloadCsv(`attendance_log_${start}_to_${end}.csv`, [header, ...body]);
  }

  const completionRate =
    taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0;

  const overEmployees = attendance.filter((r) => r.hours > threshold);

  function exportAttendance() {
    const header = ['Employee', 'Hours', 'Clock-ins', 'Overtime', 'Over threshold?'];
    const body = attendance.map((r) => [
      r.name,
      r.hours.toFixed(2),
      r.entries,
      Math.max(0, r.hours - threshold).toFixed(2),
      r.hours > threshold ? 'Yes' : 'No',
    ]);
    downloadCsv(`attendance_${start}_to_${end}.csv`, [header, ...body]);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1><BarChart2 size={20} /> Reports &amp; Analytics</h1>
          <p>Team summaries for the selected date range.</p>
        </div>
        <button className="btn btn--ghost" onClick={exportAttendance} disabled={attendance.length === 0}>
          ⬇ Export attendance CSV
        </button>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Date range */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>From</label>
            <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>To</label>
            <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat__label">Timesheets approved</div>
          <div className="stat__value">{tsCounts.approved}</div>
          <div className="stat__hint">{tsCounts.submitted} awaiting approval</div>
        </div>
        <div className="stat">
          <div className="stat__label">Task completion</div>
          <div className="stat__value">{completionRate}%</div>
          <div className="stat__hint">
            {taskStats.completed}/{taskStats.total} completed
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Over threshold</div>
          <div className="stat__value">{overEmployees.length}</div>
          <div className="stat__hint">employees over {threshold}h</div>
        </div>
        <div className="stat">
          <div className="stat__label">Timesheets rejected</div>
          <div className="stat__value">{tsCounts.rejected}</div>
          <div className="stat__hint">{tsCounts.draft} still draft</div>
        </div>
      </div>

      {/* Attendance + overtime table */}
      <div className="card">
        <div className="card__title">Attendance Summary</div>
        {loading ? (
          <SkeletonList />
        ) : attendance.length === 0 ? (
          <div className="empty-state">No data for this range.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Hours</th>
                  <th>Clock-ins</th>
                  <th>Overtime</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.hours.toFixed(2)}h</td>
                    <td>{r.entries}</td>
                    <td>{Math.max(0, r.hours - threshold).toFixed(2)}h</td>
                    <td>
                      {r.hours > threshold ? (
                        <span className="badge badge--red">Over</span>
                      ) : r.hours >= threshold * 0.9 ? (
                        <span className="badge badge--amber">Approaching</span>
                      ) : (
                        <span className="badge badge--green">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Daily clock in / out for all users */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card__title" style={{ justifyContent: 'space-between' }}>
          <span>Daily Attendance — Clock In / Out + Disposition Breakdown</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="date"
              className="input"
              style={{ maxWidth: 170 }}
              max={ymd(today)}
              value={attDate}
              onChange={(e) => setAttDate(e.target.value)}
            />
            <button
              className="btn btn--ghost btn--sm"
              onClick={exportAttendanceDay}
              disabled={attRows.length === 0}
            >
              ⬇ CSV
            </button>
          </div>
        </div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
          Total hours is the full on-clock time; the disposition columns record how it was spent.
        </div>

        {attLoading ? (
          <SkeletonList />
        ) : attRows.length === 0 ? (
          <div className="empty-state">No clock-ins on this day.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Clock in</th>
                  <th>Clock out</th>
                  <th>Total hours</th>
                  {attKinds.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {attRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{clockTime(r.firstIn)}</td>
                    <td>{r.open ? <span className="dim">Still in</span> : clockTime(r.lastOut)}</td>
                    <td>{r.hours > 0 ? `${r.hours.toFixed(2)}h` : r.open ? 'in progress' : '—'}</td>
                    {attKinds.map((k) => (
                      <td key={k}>{fmtMins(r.mins?.[k])}</td>
                    ))}
                    <td>
                      {r.open ? (
                        <span className="badge badge--green">Clocked in</span>
                      ) : (
                        <span className="badge badge--gray">Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Attendance log — one row per clock-in across the top date range */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card__title" style={{ justifyContent: 'space-between' }}>
          <span>
            Attendance Log — {start} to {end}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={exportLog} disabled={logRows.length === 0}>
            ⬇ CSV
          </button>
        </div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
          One row per clock-in across the “From / To” range at the top of the page.
        </div>

        {logLoading ? (
          <SkeletonList />
        ) : logRows.length === 0 ? (
          <div className="empty-state">No clock-ins in this range.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Clock in</th>
                  <th>Clock out</th>
                  <th>Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{dateFmt(r.clockIn)}</td>
                    <td>{clockTime(r.clockIn)}</td>
                    <td>{r.clockOut ? clockTime(r.clockOut) : <span className="dim">Still in</span>}</td>
                    <td>{r.hours != null ? `${Number(r.hours).toFixed(2)}h` : '—'}</td>
                    <td>
                      {r.status === 'completed' ? (
                        <span className="badge badge--gray">Completed</span>
                      ) : (
                        <span className="badge badge--green">{r.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
