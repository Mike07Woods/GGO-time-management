// src/pages/Timesheets.js
// Phase 2 — Timesheets.
// Auto-generates a weekly timesheet from Phase 1 time_entries, calculates total
// and overtime hours, lets users submit for approval, and lets managers+ approve
// or reject. Data visibility is enforced by RLS (own / team / all).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_BADGE = {
  draft: 'badge--gray',
  submitted: 'badge--amber',
  approved: 'badge--green',
  rejected: 'badge--red',
};

// Monday 00:00 (local) of the week containing `d`.
function startOfWeek(d) {
  const date = new Date(d);
  const dow = (date.getDay() + 6) % 7; // 0 = Monday
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - dow);
  return date;
}

// Local YYYY-MM-DD (avoids the UTC shift you'd get from toISOString).
function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
}

function prettyDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Timesheets() {
  const { user, profile } = useAuth();
  const { isManager } = useRole();
  const toast = useToast();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedUser, setSelectedUser] = useState(user.id);
  const [people, setPeople] = useState([]);
  const [dailyHours, setDailyHours] = useState({}); // ymd -> hours
  const [weeklyThreshold, setWeeklyThreshold] = useState(40);
  const [timesheet, setTimesheet] = useState(null); // saved row for this user+week
  const [list, setList] = useState([]); // submitted timesheets (for the list view)
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const weekEnd = useMemo(() => {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 6);
    return e;
  }, [weekStart]);

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
    });
    map[user.id] =
      map[user.id] || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Me';
    return map;
  }, [people, user.id, profile]);

  const totalHours = useMemo(
    () => Object.values(dailyHours).reduce((a, b) => a + b, 0),
    [dailyHours]
  );
  const overtimeHours = Math.max(0, totalHours - weeklyThreshold);

  // Load the people list (managers+ can pick anyone) + the active overtime rule.
  useEffect(() => {
    async function loadRefs() {
      if (isManager) {
        const { data } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, email')
          .order('first_name', { ascending: true });
        setPeople(data || []);
      }
      const { data: rule } = await supabase
        .from('overtime_rules')
        .select('weekly_threshold')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (rule?.weekly_threshold != null) setWeeklyThreshold(Number(rule.weekly_threshold));
    }
    loadRefs();
  }, [isManager]);

  // Recompute the daily breakdown + load the saved timesheet whenever the
  // selected user or week changes.
  const loadWeek = useCallback(async () => {
    setLoading(true);
    setError('');

    const startIso = weekStart.toISOString();
    const endExclusive = new Date(weekStart);
    endExclusive.setDate(endExclusive.getDate() + 7);

    const [entriesRes, tsRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('clock_in, total_hours, status')
        .eq('user_id', selectedUser)
        .gte('clock_in', startIso)
        .lt('clock_in', endExclusive.toISOString()),
      supabase
        .from('timesheets')
        .select('*')
        .eq('user_id', selectedUser)
        .eq('week_start', ymd(weekStart))
        .maybeSingle(),
    ]);

    if (entriesRes.error) setError(entriesRes.error.message);

    const buckets = {};
    (entriesRes.data || []).forEach((e) => {
      if (e.status !== 'completed' || e.total_hours == null) return;
      const key = ymd(e.clock_in);
      buckets[key] = (buckets[key] || 0) + Number(e.total_hours);
    });
    setDailyHours(buckets);
    setTimesheet(tsRes.data || null);
    setLoading(false);
  }, [selectedUser, weekStart]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  // Load the timesheets list (RLS scopes it to what the viewer may see).
  const loadList = useCallback(async () => {
    let q = supabase.from('timesheets').select('*').order('week_start', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data } = await q;
    setList(data || []);
  }, [statusFilter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  function shiftWeek(deltaWeeks) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + deltaWeeks * 7);
    setWeekStart(startOfWeek(d));
  }

  // Submit (or re-submit) the current week's timesheet for approval. Own week only.
  async function submitForApproval() {
    setBusy(true);
    setError('');
    const payload = {
      user_id: user.id,
      week_start: ymd(weekStart),
      week_end: ymd(weekEnd),
      total_hours: Number(totalHours.toFixed(2)),
      overtime_hours: Number(overtimeHours.toFixed(2)),
      status: 'submitted',
    };
    const { error } = await supabase
      .from('timesheets')
      .upsert(payload, { onConflict: 'user_id,week_start' });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    loadWeek();
    loadList();
    toast.success('Timesheet submitted for approval');
  }

  // Approve / reject a timesheet (managers+).
  async function decide(ts, status) {
    setError('');
    const { error } = await supabase
      .from('timesheets')
      .update({ status, approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', ts.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    loadWeek();
    loadList();
    toast.success(`Timesheet ${status}`);
  }

  const viewingOwn = selectedUser === user.id;
  const canSubmit = viewingOwn && (!timesheet || timesheet.status === 'rejected' || timesheet.status === 'draft');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Timesheets</h1>
          <p>Weekly hours generated from your time clock entries.</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Week builder */}
      <div className="card">
        <div className="card__title">
          <span>
            Week of {prettyDate(weekStart)} – {prettyDate(weekEnd)}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(-1)}>
              ← Prev
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(1)}>
              Next →
            </button>
          </span>
        </div>

        {/* Employee picker for managers+ */}
        {isManager && (
          <div className="field" style={{ maxWidth: 280 }}>
            <label>Employee</label>
            <select
              className="select"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value={user.id}>Me ({nameById[user.id]})</option>
              {people
                .filter((p) => p.id !== user.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameById[p.id]}
                  </option>
                ))}
            </select>
          </div>
        )}

        {loading ? (
          <p className="muted">Loading week…</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {DAY_LABELS.map((d, i) => {
                      const day = new Date(weekStart);
                      day.setDate(day.getDate() + i);
                      return (
                        <th key={d}>
                          {d} <span className="dim">{prettyDate(day)}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {DAY_LABELS.map((d, i) => {
                      const day = new Date(weekStart);
                      day.setDate(day.getDate() + i);
                      const h = dailyHours[ymd(day)] || 0;
                      return (
                        <td key={d} style={{ fontWeight: h ? 600 : 400 }}>
                          {h ? `${h.toFixed(2)}h` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="row row--between" style={{ marginTop: 16, flexWrap: 'wrap', gap: 16 }}>
              <div className="row" style={{ gap: 24 }}>
                <div>
                  <div className="stat__label">Total hours</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{totalHours.toFixed(2)}</div>
                </div>
                <div>
                  <div className="stat__label">Overtime</div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      color: overtimeHours > 0 ? '#f0888b' : undefined,
                    }}
                  >
                    {overtimeHours.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="stat__label">Status</div>
                  <div style={{ marginTop: 6 }}>
                    {timesheet ? (
                      <span className={'badge ' + (STATUS_BADGE[timesheet.status] || 'badge--gray')}>
                        {timesheet.status}
                      </span>
                    ) : (
                      <span className="badge badge--gray">not submitted</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 8 }}>
                {canSubmit && (
                  <button className="btn btn--primary" disabled={busy} onClick={submitForApproval}>
                    {busy ? 'Submitting…' : 'Submit for approval'}
                  </button>
                )}
                {/* Managers can act on a submitted timesheet for the selected week */}
                {isManager && timesheet?.status === 'submitted' && (
                  <>
                    <button className="btn btn--primary btn--sm" onClick={() => decide(timesheet, 'approved')}>
                      Approve
                    </button>
                    <button className="btn btn--danger btn--sm" onClick={() => decide(timesheet, 'rejected')}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Timesheets list */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card__title">
          <span>Timesheets</span>
          <select
            className="select"
            style={{ maxWidth: 170 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        {list.length === 0 ? (
          <div className="empty-state">No timesheets to show.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Week</th>
                  <th>Total</th>
                  <th>Overtime</th>
                  <th>Status</th>
                  {isManager && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((ts) => (
                  <tr key={ts.id}>
                    <td>{nameById[ts.user_id] || ts.user_id.slice(0, 8)}</td>
                    <td>
                      {prettyDate(ts.week_start)} – {prettyDate(ts.week_end)}
                    </td>
                    <td>{Number(ts.total_hours || 0).toFixed(2)}h</td>
                    <td>{Number(ts.overtime_hours || 0).toFixed(2)}h</td>
                    <td>
                      <span className={'badge ' + (STATUS_BADGE[ts.status] || 'badge--gray')}>
                        {ts.status}
                      </span>
                    </td>
                    {isManager && (
                      <td>
                        {ts.status === 'submitted' ? (
                          <div className="row">
                            <button
                              className="btn btn--primary btn--sm"
                              onClick={() => decide(ts, 'approved')}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => decide(ts, 'rejected')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    )}
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
