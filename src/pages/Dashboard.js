// src/pages/Dashboard.js
// Landing page after login. Shows a greeting and a few live stat tiles plus the
// user's upcoming shifts. All data is scoped to the current user.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';

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

  const [loading, setLoading] = useState(true);
  const [upcomingShifts, setUpcomingShifts] = useState([]);
  const [clockStatus, setClockStatus] = useState('Clocked out');
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

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
          <div className="stat__value">{loading ? '—' : upcomingShifts.length}</div>
          <div className="stat__hint">Published &amp; assigned to you</div>
        </Link>

        <Link to="/timeclock" className="stat">
          <div className="stat__label">Time Clock</div>
          <div className="stat__value" style={{ fontSize: 22, marginTop: 12 }}>
            {clockStatus}
          </div>
          <div className="stat__hint">Tap to clock in / out</div>
        </Link>

        <Link to="/announcements" className="stat">
          <div className="stat__label">Unread Announcements</div>
          <div className="stat__value">{loading ? '—' : unreadAnnouncements}</div>
          <div className="stat__hint">Tap to read &amp; acknowledge</div>
        </Link>

        <Link to="/notifications" className="stat">
          <div className="stat__label">Notifications</div>
          <div className="stat__value">{loading ? '—' : unreadNotifications}</div>
          <div className="stat__hint">Unread in-app alerts</div>
        </Link>
      </div>

      {/* Upcoming shifts list */}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="card__title">
          Your Upcoming Shifts
          <Link to="/scheduling" className="btn btn--ghost btn--sm">
            View all
          </Link>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
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
