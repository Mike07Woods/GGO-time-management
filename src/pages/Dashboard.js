// src/pages/Dashboard.js
// Landing page after login. A greeting line, icon-led stat cards (personal +,
// for managers, a team row) and the user's upcoming shifts as a compact table.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Clock,
  Megaphone,
  Bell,
  Users,
  UserCheck,
  ClipboardCheck,
  LifeBuoy,
  CalendarX,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';
import Skeleton from '../components/Skeleton';

const TONES = {
  blue: { bg: 'var(--accent-light)', fg: 'var(--accent-text)' },
  green: { bg: 'var(--green-light)', fg: 'var(--green)' },
  amber: { bg: 'var(--amber-light)', fg: 'var(--amber)' },
  purple: { bg: 'var(--purple-light)', fg: 'var(--purple)' },
  red: { bg: 'var(--red-light)', fg: 'var(--red)' },
};

// One icon-left stat card. Renders as a link when `to` is given.
function StatCard({ to, icon: Icon, tone, value, label, sub, loading, valueSize }) {
  const t = TONES[tone] || TONES.blue;
  const inner = (
    <>
      <div className="stat-card__icon" style={{ background: t.bg, color: t.fg }}>
        <Icon size={20} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-card__value" style={valueSize ? { fontSize: valueSize } : undefined}>
          {loading ? <Skeleton width={44} height={22} /> : value}
        </div>
        <div className="stat-card__label">{label}</div>
        {sub && <div className="stat-card__sub">{sub}</div>}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="stat-card">
      {inner}
    </Link>
  ) : (
    <div className="stat-card">{inner}</div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function shiftDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function shiftTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
    if (!user) return undefined;
    let active = true;

    async function load() {
      const nowIso = new Date().toISOString();

      const shiftsReq = supabase
        .from('shifts')
        .select('*')
        .eq('assigned_to', user.id)
        .eq('status', 'published')
        .gte('start_time', nowIso)
        .order('start_time', { ascending: true })
        .limit(5);

      const timeReq = supabase
        .from('time_entries')
        .select('status')
        .eq('user_id', user.id)
        .in('status', ['active', 'on_break'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const annReq = supabase
        .from('announcements')
        .select('id')
        .or(`target_role.is.null,target_role.eq.${profile?.role || 'user'}`);

      const readsReq = supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id);

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
      setUnreadAnnouncements((annRes.data || []).filter((a) => !readIds.has(a.id)).length);
      setUnreadNotifications(notifRes.count || 0);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [user, profile]);

  // Team snapshot — manager/admin/owner only (cheap count-only queries).
  useEffect(() => {
    if (!user || !isManager) return undefined;
    let active = true;

    async function loadTeam() {
      const [employeesRes, clockedInRes, approvalsRes, ticketsRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('time_entries').select('id', { count: 'exact', head: true }).in('status', ['active', 'on_break']),
        supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('helpdesk_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
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
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <style>{`.dash-shifts .table td { height: 44px; }`}</style>

      {/* Greeting */}
      <div
        className="row"
        style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>
          {greeting()}, {firstName} 👋
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{today}</div>
      </div>

      {/* Personal stats */}
      <div className="grid grid--stats">
        <StatCard
          to="/scheduling"
          icon={CalendarClock}
          tone="blue"
          loading={loading}
          value={upcomingShifts.length}
          label="Upcoming Shifts"
          sub="Published & assigned to you"
        />
        <StatCard
          to="/timeclock"
          icon={Clock}
          tone="green"
          loading={loading}
          value={clockStatus}
          valueSize={16}
          label="Time Clock"
          sub="Tap to clock in / out"
        />
        <StatCard
          to="/announcements"
          icon={Megaphone}
          tone="amber"
          loading={loading}
          value={unreadAnnouncements}
          label="Announcements"
          sub="Unread & to acknowledge"
        />
        <StatCard
          to="/notifications"
          icon={Bell}
          tone="purple"
          loading={loading}
          value={unreadNotifications}
          label="Notifications"
          sub="Unread in-app alerts"
        />
      </div>

      {/* Team stats — managers, admins and owners only */}
      {isManager && (
        <div className="grid grid--stats" style={{ marginTop: 16 }}>
          <StatCard
            to="/directory"
            icon={Users}
            tone="blue"
            loading={!teamStats}
            value={teamStats?.employees}
            label="Active Employees"
            sub="Currently active"
          />
          <StatCard
            icon={UserCheck}
            tone="green"
            loading={!teamStats}
            value={teamStats?.clockedIn}
            label="Clocked In Now"
            sub="On the clock / on break"
          />
          <StatCard
            to="/timesheets"
            icon={ClipboardCheck}
            tone="amber"
            loading={!teamStats}
            value={teamStats?.approvals}
            label="Pending Approvals"
            sub="Timesheets to review"
          />
          <StatCard
            icon={LifeBuoy}
            tone="red"
            loading={!teamStats}
            value={teamStats?.tickets}
            label="Open Tickets"
            sub="Unresolved help desk"
          />
        </div>
      )}

      {/* Upcoming shifts */}
      <div className="card dash-shifts" style={{ marginTop: 20 }}>
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
              </div>
            ))}
          </div>
        ) : upcomingShifts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
            <CalendarX size={26} style={{ marginBottom: 8, opacity: 0.7 }} />
            <div style={{ fontSize: 14 }}>No upcoming shifts</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Shift</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {upcomingShifts.map((shift) => (
                  <tr key={shift.id}>
                    <td style={{ fontWeight: 600 }}>{shift.title || 'Shift'}</td>
                    <td>{shiftDate(shift.start_time)}</td>
                    <td>
                      {shiftTime(shift.start_time)} – {shiftTime(shift.end_time)}
                    </td>
                    <td>{shift.location || '—'}</td>
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
