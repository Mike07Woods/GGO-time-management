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
    </div>
  );
}
