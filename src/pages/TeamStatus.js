// src/pages/TeamStatus.js
// Live Team Status Monitor (manager/admin/owner). Reads live presence from the
// global PresenceProvider (no polling — Realtime keeps it fresh) and joins it
// with profiles + departments. Managers are scoped to their own department;
// admins/owners can see everyone or filter. Manager+ can "ping" a teammate,
// which inserts a status_pings row (a DB trigger turns it into an in-app
// notification for the target).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bell, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { usePresence } from '../context/PresenceContext';
import { supabase } from '../supabaseClient';
import Skeleton from '../components/Skeleton';

// Grid ordering: online statuses first, Offline last.
const STATUS_RANK = { Active: 0, 'On Break': 1, 'In Meeting': 1, 'On Call': 1, AFK: 3, Offline: 4 };
const rankOf = (name) => (STATUS_RANK[name] != null ? STATUS_RANK[name] : 2);

// Human "x mins ago" from a timestamp.
function timeAgo(ts) {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '—';
}

function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
}
function hoursFmt(mins) {
  if (!mins) return '—';
  return `${(mins / 60).toFixed(1)}h`;
}
// Live "how long in this status" — e.g. "12m" or "1h 05m".
function durationSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function clockTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}

export default function TeamStatus() {
  const { user, profile } = useAuth();
  const { isManager, isAdmin } = useRole();
  const toast = useToast();
  const { enabled, allPresence, getStatus, statusById, settings } = usePresence();

  const canPing = isManager; // manager/admin/owner
  const adminView = isAdmin; // admins/owners may change the department filter

  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myPings, setMyPings] = useState({}); // to_user_id -> last ping ms
  const [clockInfo, setClockInfo] = useState({}); // user_id -> today's clock in/out
  const [statusFilter, setStatusFilter] = useState('all');
  // Managers are locked to their own department; admins/owners default to "all".
  const [deptFilter, setDeptFilter] = useState('all');

  // Ping popover state.
  const [pingTarget, setPingTarget] = useState(null);
  const [pingMsg, setPingMsg] = useState('');
  const [sending, setSending] = useState(false);

  const cooldownMs = (settings.ping_cooldown_minutes || 5) * 60000;

  const load = useCallback(async () => {
    setLoading(true);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [peopleRes, deptRes, pingRes, entriesRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, avatar_url, department_id, is_active')
        .eq('is_active', true)
        .order('first_name', { ascending: true }),
      supabase.from('departments').select('id, name'),
      supabase.from('status_pings').select('to_user_id, created_at').eq('from_user_id', user.id),
      supabase
        .from('time_entries')
        .select('user_id, clock_in, clock_out, status')
        .gte('clock_in', startOfDay.toISOString()),
    ]);
    setPeople(peopleRes.data || []);
    setDepartments(deptRes.error ? [] : deptRes.data || []);
    // Track the most recent ping per target for cooldown display.
    const pings = {};
    (pingRes.data || []).forEach((row) => {
      const t = new Date(row.created_at).getTime();
      if (!pings[row.to_user_id] || t > pings[row.to_user_id]) pings[row.to_user_id] = t;
    });
    setMyPings(pings);

    // First clock-in + last clock-out today, and whether they're still on the clock.
    const ci = {};
    (entriesRes.data || []).forEach((e) => {
      const cur = ci[e.user_id] || { firstIn: null, firstInMs: Infinity, lastOut: null, lastOutMs: 0, open: false };
      const inMs = new Date(e.clock_in).getTime();
      if (inMs < cur.firstInMs) {
        cur.firstIn = e.clock_in;
        cur.firstInMs = inMs;
      }
      if (e.status !== 'completed') cur.open = true;
      if (e.clock_out) {
        const outMs = new Date(e.clock_out).getTime();
        if (outMs > cur.lastOutMs) {
          cur.lastOut = e.clock_out;
          cur.lastOutMs = outMs;
        }
      }
      ci[e.user_id] = cur;
    });
    setClockInfo(ci);
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Managers default to (and are locked to) their own department.
  useEffect(() => {
    if (!adminView && profile?.department_id) setDeptFilter(profile.department_id);
  }, [adminView, profile]);

  const deptName = useMemo(() => {
    const map = {};
    departments.forEach((d) => (map[d.id] = d.name));
    return map;
  }, [departments]);

  // Re-render every 30s so stale statuses + "last active" stay current without
  // waiting on a Realtime event.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Resolve the live (stale-aware) status object for a person.
  const statusOf = useCallback((p) => getStatus(p.id), [getStatus]);

  // Department-scoped list (respects manager lock + admin filter).
  const deptScoped = useMemo(() => {
    return people.filter((p) => {
      if (deptFilter === 'all') return true;
      if (deptFilter === 'unassigned') return !p.department_id;
      return p.department_id === deptFilter;
    });
  }, [people, deptFilter]);

  // Summary counts (over the department-scoped list, before the status filter).
  const summary = useMemo(() => {
    const s = { online: 0, Active: 0, 'On Break': 0, AFK: 0, Offline: 0 };
    deptScoped.forEach((p) => {
      const name = statusOf(p).name;
      if (s[name] != null) s[name] += 1;
      if (name !== 'Offline') s.online += 1;
    });
    return s;
  }, [deptScoped, statusOf]);

  // Apply the status filter, then sort Online -> Offline (ties by name).
  const visible = useMemo(() => {
    const target = statusFilter === 'break' ? 'On Break' : statusFilter;
    const list =
      statusFilter === 'all'
        ? [...deptScoped]
        : deptScoped.filter((p) => statusOf(p).name.toLowerCase() === target.toLowerCase());
    return list.sort((a, b) => {
      const ra = rankOf(statusOf(a).name);
      const rb = rankOf(statusOf(b).name);
      if (ra !== rb) return ra - rb;
      return fullName(a).localeCompare(fullName(b));
    });
  }, [deptScoped, statusFilter, statusOf]);

  function openPing(person) {
    setPingTarget(person);
    setPingMsg('');
  }

  async function sendPing() {
    if (!pingTarget) return;
    setSending(true);
    const { error } = await supabase.from('status_pings').insert({
      from_user_id: user.id,
      to_user_id: pingTarget.id,
      message: pingMsg.trim() || null,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMyPings((prev) => ({ ...prev, [pingTarget.id]: Date.now() }));
    toast.success(`Ping sent to ${fullName(pingTarget)}`);
    setPingTarget(null);
    setPingMsg('');
  }

  // --- Presence analytics (from presence_log) ---
  const [anaDate, setAnaDate] = useState(ymd(new Date()));
  const [logRows, setLogRows] = useState([]);
  const [anaLoading, setAnaLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      setAnaLoading(true);
      const dayStart = new Date(`${anaDate}T00:00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const { data } = await supabase
        .from('presence_log')
        .select('user_id, status_type_id, started_at')
        .gte('started_at', dayStart.toISOString())
        .lt('started_at', dayEnd.toISOString())
        .order('started_at', { ascending: true });
      if (!cancelled) {
        setLogRows(data || []);
        setAnaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, anaDate]);

  // Minutes spent per status per person for the chosen day (durations between
  // consecutive log entries, clamped to the day and to "now").
  const analytics = useMemo(() => {
    const dayStart = new Date(`${anaDate}T00:00:00`).getTime();
    const dayEnd = Math.min(dayStart + 24 * 3600 * 1000, Date.now());
    const byUser = {};
    logRows.forEach((r) => {
      (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
    });
    return deptScoped
      .map((p) => {
        const rows = byUser[p.id] || [];
        const mins = {};
        for (let i = 0; i < rows.length; i++) {
          const segStart = new Date(rows[i].started_at).getTime();
          const segEnd = i + 1 < rows.length ? new Date(rows[i + 1].started_at).getTime() : dayEnd;
          const s = Math.max(segStart, dayStart);
          const e = Math.min(segEnd, dayEnd);
          if (e > s) {
            const name = statusById(rows[i].status_type_id)?.name || 'Unknown';
            mins[name] = (mins[name] || 0) + (e - s) / 60000;
          }
        }
        const active = mins.Active || 0;
        return { id: p.id, name: fullName(p), mins, active };
      })
      .filter((r) => Object.keys(r.mins).length > 0)
      .sort((a, b) => b.active - a.active);
  }, [logRows, deptScoped, statusById, anaDate]);

  const summaryCards = [
    { key: 'online', label: 'Total Online', color: '#00D15E', value: summary.online },
    { key: 'Active', label: 'Active', color: '#00D15E', value: summary.Active },
    { key: 'On Break', label: 'On Break', color: '#F59E0B', value: summary['On Break'] },
    { key: 'AFK', label: 'AFK', color: '#EF4444', value: summary.AFK },
    { key: 'Offline', label: 'Offline', color: '#6B7280', value: summary.Offline },
  ];

  return (
    <div>
      <style>{`
        .ts-live { display:inline-flex; align-items:center; gap:6px; font-size:13px; color: var(--text-secondary); }
        .ts-live .dot { width:9px; height:9px; border-radius:50%; background:#00D15E; box-shadow:0 0 0 0 rgba(0,209,94,0.6); animation: ts-pulse 1.8s infinite; }
        @keyframes ts-pulse {
          0% { box-shadow:0 0 0 0 rgba(0,209,94,0.55); }
          70% { box-shadow:0 0 0 8px rgba(0,209,94,0); }
          100% { box-shadow:0 0 0 0 rgba(0,209,94,0); }
        }
        .ts-summary { display:grid; grid-template-columns: repeat(5, 1fr); gap:12px; margin:18px 0; }
        @media (max-width: 720px){ .ts-summary { grid-template-columns: repeat(2, 1fr); } }
        .ts-sum { display:flex; flex-direction:column; gap:4px; }
        .ts-sum .row { display:flex; align-items:center; gap:7px; }
        .ts-sum .cdot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
        .ts-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap:14px; }
        .ts-card { position:relative; display:flex; gap:12px; align-items:flex-start; }
        .ts-av { position:relative; flex-shrink:0; }
        .ts-av .ring { padding:2px; border-radius:50%; display:inline-block; }
        .ts-note { font-size:12px; color: var(--text-secondary); margin-top:4px; font-style:italic; }
        .ts-ago { font-size:11px; color: var(--text-muted); margin-top:3px; }
        .ts-ping { position:absolute; top:0; right:0; }
        .ts-statusline { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; margin-top:3px; }
      `}</style>

      <div className="page-header">
        <div className="row" style={{ gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Activity size={22} /> Live Team Status
          </h1>
          <span className="ts-live">
            <span className="dot" /> Live
          </span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {/* Department filter — admins/owners can change; managers are locked. */}
          {adminView ? (
            departments.length > 0 && (
              <select
                className="select"
                style={{ maxWidth: 200 }}
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
              >
                <option value="all">All departments</option>
                <option value="unassigned">Unassigned</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )
          ) : (
            <span className="badge badge--teal">
              {deptName[deptFilter] || 'My department'}
            </span>
          )}

          <select
            className="select"
            style={{ maxWidth: 160 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="break">On Break</option>
            <option value="afk">AFK</option>
            <option value="offline">Offline</option>
          </select>
        </div>
      </div>

      {!enabled && !loading && (
        <div className="alert alert--info">
          Live presence isn’t set up yet. Run <code>supabase-team-status.sql</code> in the Supabase
          SQL Editor to enable real-time statuses.
        </div>
      )}

      {/* Summary row */}
      <div className="ts-summary">
        {summaryCards.map((c) => (
          <div key={c.key} className="stat ts-sum">
            <div className="row">
              <span className="cdot" style={{ background: c.color }} />
              <span className="stat__label">{c.label}</span>
            </div>
            <div className="stat__value">{c.value}</div>
          </div>
        ))}
      </div>

      {/* User grid */}
      {loading ? (
        <div className="ts-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card ts-card">
              <Skeleton width={48} height={48} radius={999} />
              <div style={{ flex: 1 }}>
                <Skeleton width="55%" height={14} style={{ marginBottom: 8 }} />
                <Skeleton width="35%" height={11} />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="card empty-state">No teammates match this filter.</div>
      ) : (
        <div className="ts-grid">
          {visible.map((p) => {
            const st = statusOf(p);
            const pres = allPresence[p.id];
            const isMe = p.id === user.id;
            const showAgo = st.name === 'AFK' || st.name === 'Offline';
            const lastPing = myPings[p.id];
            const onCooldown = lastPing && Date.now() - lastPing < cooldownMs;

            // Live disposition duration + over-limit detection.
            const enteredAt = pres?.updated_at;
            const durMin = enteredAt ? (Date.now() - new Date(enteredAt).getTime()) / 60000 : 0;
            const overBy = st.max_minutes && durMin > st.max_minutes ? Math.round(durMin - st.max_minutes) : 0;
            const ci = clockInfo[p.id];

            return (
              <div key={p.id} className="card ts-card">
                {/* Ping button (manager+, not self) */}
                {canPing && !isMe && (
                  <div className="ts-ping">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => openPing(p)}
                      disabled={onCooldown}
                      title={
                        onCooldown
                          ? `Pinged ${timeAgo(lastPing)}`
                          : `Ping ${fullName(p)}`
                      }
                      aria-label={`Ping ${fullName(p)}`}
                    >
                      <Bell size={15} />
                    </button>
                  </div>
                )}

                <div className="ts-av">
                  <span className="ring" style={{ boxShadow: `0 0 0 2px ${st.color}` }}>
                    <div className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>
                      {p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p)}
                    </div>
                  </span>
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {fullName(p)} {isMe && <span className="dim">(you)</span>}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span className="badge badge--purple">{p.role || 'user'}</span>
                    {deptName[p.department_id] && (
                      <span className="dim" style={{ fontSize: 12 }}>
                        {deptName[p.department_id]}
                      </span>
                    )}
                  </div>

                  <div className="ts-statusline" style={{ color: st.color }}>
                    <span>{st.emoji}</span> {st.name}
                    {enteredAt && st.name !== 'Offline' && (
                      <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>
                        · for {durationSince(enteredAt)}
                      </span>
                    )}
                  </div>

                  {overBy > 0 && (
                    <span className="badge badge--red" style={{ marginTop: 4 }}>
                      ⚠ Over limit by {overBy}m
                    </span>
                  )}

                  {pres?.custom_note && <div className="ts-note">“{pres.custom_note}”</div>}
                  {showAgo && pres?.last_active_at && (
                    <div className="ts-ago">Last active {timeAgo(pres.afk_at || pres.last_active_at)}</div>
                  )}
                  {ci && (
                    <div className="ts-ago">
                      In {clockTime(ci.firstIn)} · Out {ci.open ? '—' : clockTime(ci.lastOut)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Presence analytics — time in each status for a chosen day */}
      {enabled && (
        <div className="card" style={{ marginTop: 18 }}>
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}
          >
            <div className="card__title" style={{ margin: 0 }}>
              Presence Analytics
            </div>
            <input
              type="date"
              className="input"
              style={{ maxWidth: 170 }}
              max={ymd(new Date())}
              value={anaDate}
              onChange={(e) => setAnaDate(e.target.value)}
            />
          </div>
          <div className="dim" style={{ fontSize: 12, margin: '4px 0 12px' }}>
            Hours spent in each status on the selected day.
          </div>

          {anaLoading ? (
            <Skeleton width="100%" height={80} />
          ) : analytics.length === 0 ? (
            <div className="empty-state">No presence recorded for this day yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>🟢 Active</th>
                    <th>🟡 On Break</th>
                    <th>🔴 AFK</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{hoursFmt(r.mins.Active)}</td>
                      <td>{hoursFmt(r.mins['On Break'])}</td>
                      <td>{hoursFmt(r.mins.AFK)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Ping popover (simple centered modal) */}
      {pingTarget && (
        <div className="modal-overlay" onClick={() => setPingTarget(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div
              className="row"
              style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}
            >
              <h3 style={{ margin: 0 }}>Send a ping to {fullName(pingTarget)}</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setPingTarget(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="field">
              <label>Message (optional)</label>
              <input
                className="input"
                maxLength={100}
                autoFocus
                value={pingMsg}
                onChange={(e) => setPingMsg(e.target.value)}
                placeholder="e.g. Are you free for a quick call?"
              />
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{pingMsg.length}/100</div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn--ghost" onClick={() => setPingTarget(null)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={sendPing} disabled={sending}>
                {sending ? 'Sending…' : 'Send ping'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
