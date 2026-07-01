// src/pages/Dashboard.js
// Landing page after login. Shows a greeting and a few live stat tiles plus the
// user's upcoming shifts. All data is scoped to the current user.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';
import Skeleton from '../components/Skeleton';

// Format a timestamp like "Mon, Jun 23 · 9:00 AM".
function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Dashboard() {
  const { user, profile } = useAuth();
  const { isManager } = useRole();

  const [loading, setLoading] = useState(true);
  const [upcomingShifts, setUpcomingShifts] = useState([]);
  const [clockStatus, setClockStatus] = useState('Clocked out');
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [teamStats, setTeamStats] = useState(null); // manager+ only

  useEffect(() => {
    if (!user) return;

    let active = true;

    async function load() {
      const nowIso = new Date().toISOString();

      // Upcoming published shifts assigned to me.
      const shiftsReq = supabase
        .from('shifts')
        .select('*')
        .eq('assigned_to', user.id)
        .eq('status', 'published')
        .gte('start_time', nowIso)
        .order('start_time', { ascending: true })
        .limit(5);

      // My current open time entry (if any).
      const timeReq = supabase
        .from('time_entries')
        .select('status')
        .eq('user_id', user.id)
        .in('status', ['active', 'on_break'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // All announcements visible to me (everyone-targeted or my role).
      const annReq = supabase
        .from('announcements')
        .select('id')
        .or(`target_role.is.null,target_role.eq.${profile?.role || 'user'}`);

      // Which announcements I've already read.
      const readsReq = supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id);

      // Unread in-app notifications.
      const notifReq = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      const [shiftsRes, timeRes, annRes, readsRes, notifRes] = await Promise.all([
        shiftsReq,
        timeReq,
        annReq,
        readsReq,
        notifReq,
      ]);

      if (!active) return;

      setUpcomingShifts(shiftsRes.data || []);

      const status = timeRes.data?.status;
      setClockStatus(status === 'active' ? 'Clocked in' : status === 'on_break' ? 'On break' : 'Clocked out');

      const readIds = new Set((readsRes.data || []).map((r) => r.announcement_id));
      const unreadAnn = (annRes.data || []).filter((a) => !readIds.has(a.id)).length;
      setUnreadAnnouncements(unreadAnn);

      setUnreadNotifications(notifRes.count || 0);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [user, profile]);

  // Team snapshot — manager/admin/owner only. Uses count-only queries (cheap).
  useEffect(() => {
    if (!user || !isManager) return undefined;
    let active = true;

    async function loadTeam() {
      const [employeesRes, clockedInRes, approvalsRes, ticketsRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase
          .from('time_entries')
          .select('id', { count: 'exact', head: true })
          .in('status', ['active', 'on_break']),
        supabase
          .from('timesheets')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted'),
        supabase
          .from('helpdesk_tickets')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'in_progress']),
      ]);
      if (!active) return;
      setTeamStats({
        employees: employeesRes.count || 0,
        clockedIn: clockedInRes.count || 0,
        approvals: approvalsRes.count || 0,
        tickets: ticketsRes.count || 0,
      });
    }

    loadTeam();
    return () => {
      active = false;
    };
  }, [user, isManager]);

  const firstName = profile?.first_name || 'there';

  return (
    <div>
      <div className="dashboard-hero">
        <div className="page-header" style={{ margin: 0 }}>
          <div>
            <h1>Welcome back, {firstName} 👋</h1>
            <p>Here's a quick look at your day.</p>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid--stats">
        <Link to="/scheduling" className="stat">
          <div className="stat__label">Upcoming Shifts</div>
          <div className="stat__value">
            {loading ? <Skeleton width={56} height={30} style={{ marginTop: 6 }} /> : upcomingShifts.length}
          </div>
          <div className="stat__hint">Published &amp; assigned to you</div>
        </Link>

        <Link to="/timeclock" className="stat">
          <div className="stat__label">Time Clock</div>
          <div className="stat__value" style={{ fontSize: 22, marginTop: 12 }}>
            {loading ? <Skeleton width={110} height={22} /> : clockStatus}
          </div>
          <div className="stat__hint">Tap to clock in / out</div>
        </Link>

        <Link to="/announcements" className="stat">
          <div className="stat__label">Unread Announcements</div>
          <div className="stat__value">
            {loading ? <Skeleton width={56} height={30} style={{ marginTop: 6 }} /> : unreadAnnouncements}
          </div>
          <div className="stat__hint">Tap to read &amp; acknowledge</div>
        </Link>

        <Link to="/notifications" className="stat">
          <div className="stat__label">Notifications</div>
          <div className="stat__value">
            {loading ? <Skeleton width={56} height={30} style={{ marginTop: 6 }} /> : unreadNotifications}
          </div>
          <div className="stat__hint">Unread in-app alerts</div>
        </Link>
      </div>

      {/* Team snapshot — managers, admins and owners only */}
      {isManager && (
        <div style={{ marginTop: 26 }}>
          <div className="stat__label" style={{ marginBottom: 10 }}>
            Team Snapshot
          </div>
          <div className="grid grid--stats">
            <Link to="/directory" className="stat">
              <div className="stat__label">Active Employees</div>
              <div className="stat__value">
                {teamStats ? teamStats.employees : <Skeleton width={56} height={30} style={{ marginTop: 6 }} />}
              </div>
              <div className="stat__hint">Currently active</div>
            </Link>
            <div className="stat">
              <div className="stat__label">Clocked In Now</div>
              <div className="stat__value">
                {teamStats ? teamStats.clockedIn : <Skeleton width={56} height={30} style={{ marginTop: 6 }} />}
              </div>
              <div className="stat__hint">On the clock / on break</div>
            </div>
            <Link to="/timesheets" className="stat">
              <div className="stat__label">Pending Approvals</div>
              <div className="stat__value">
                {teamStats ? teamStats.approvals : <Skeleton width={56} height={30} style={{ marginTop: 6 }} />}
              </div>
              <div className="stat__hint">Timesheets to review</div>
            </Link>
            <div className="stat">
              <div className="stat__label">Open Tickets</div>
              <div className="stat__value">
                {teamStats ? teamStats.tickets : <Skeleton width={56} height={30} style={{ marginTop: 6 }} />}
              </div>
              <div className="stat__hint">Unresolved help desk</div>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming shifts list */}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="card__title">
          Your Upcoming Shifts
          <Link to="/scheduling" className="btn btn--ghost btn--sm">
            View all
          </Link>
        </div>

        {loading ? (
          <div className="stack">
            {[0, 1, 2].map((i) => (
              <div key={i} className="row row--between" style={{ padding: '6px 0' }}>
                <div style={{ flex: 1 }}>
                  <Skeleton width="40%" height={14} style={{ marginBottom: 8 }} />
                  <Skeleton width="60%" height={12} />
                </div>
                <Skeleton width={90} height={22} radius={999} />
              </div>
            ))}
          </div>
        ) : upcomingShifts.length === 0 ? (
          <div className="empty-state">No upcoming shifts assigned to you yet.</div>
        ) : (
          <div className="stack">
            {upcomingShifts.map((shift) => (
              <div key={shift.id} className="row row--between" style={{ padding: '6px 0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{shift.title || 'Shift'}</div>
                  <div className="dim" style={{ fontSize: 13 }}>
                    {formatDateTime(shift.start_time)} → {formatDateTime(shift.end_time)}
                  </div>
                </div>
                <span className="badge badge--gray">{shift.location || 'No location'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
