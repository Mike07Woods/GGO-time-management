// src/components/Sidebar.js
// Minimal, collapsible sidebar with grouped sections, Lucide icons, active
// highlight, and icon-only collapse with hover tooltips. Collapse state persists
// to localStorage.

import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Clock,
  AlarmClock,
  Megaphone,
  Bell,
  MessageSquare,
  CheckSquare,
  ClipboardList,
  Timer,
  BarChart2,
  BookOpen,
  LifeBuoy,
  CalendarCheck,
  ScrollText,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import logoIconWhite from '../assets/ggo-icon-white.png';
import logoFullWhite from '../assets/ggo-full-white.png';

function initials(profile, email) {
  const f = profile?.first_name?.[0] || '';
  const l = profile?.last_name?.[0] || '';
  return (f + l).toUpperCase() || (email?.[0]?.toUpperCase() ?? '?');
}

// Nav items grouped into labelled sections. `icon` is a Lucide component; each
// item's `visible` predicate receives the useRole() context.
const GROUPS = [
  {
    label: 'Main',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, visible: () => true },
      { to: '/directory', label: 'Directory', icon: Users, visible: (r) => r.isManager },
      { to: '/scheduling', label: 'Scheduling', icon: CalendarDays, visible: () => true },
      { to: '/timeclock', label: 'Time Clock', icon: Clock, visible: () => true },
    ],
  },
  {
    label: 'Comms',
    items: [
      { to: '/announcements', label: 'Announcements', icon: Megaphone, visible: () => true },
      { to: '/notifications', label: 'Notifications', icon: Bell, visible: () => true },
      { to: '/chat', label: 'Chat', icon: MessageSquare, visible: () => true },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/tasks', label: 'Tasks', icon: CheckSquare, visible: () => true },
      { to: '/forms', label: 'Forms', icon: ClipboardList, visible: () => true },
      { to: '/timesheets', label: 'Timesheets', icon: Timer, visible: () => true },
      { to: '/overtime', label: 'Overtime', icon: AlarmClock, visible: (r) => r.isManager },
      { to: '/reports', label: 'Reports', icon: BarChart2, visible: (r) => r.isAdmin },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/knowledge', label: 'Knowledge Base', icon: BookOpen, visible: () => true },
      { to: '/helpdesk', label: 'Help Desk', icon: LifeBuoy, visible: () => true },
      { to: '/events', label: 'Events', icon: CalendarCheck, visible: () => true },
      { to: '/audit', label: 'Audit Log', icon: ScrollText, visible: (r) => r.isOwner },
    ],
  },
];

export default function Sidebar() {
  const roleCtx = useRole();
  const { role } = roleCtx;
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch (e) {
      return false;
    }
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', String(next));
      } catch (e) {
        /* ignore */
      }
      return next;
    });
  }

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || 'User';

  return (
    <aside className={'gsb' + (collapsed ? ' gsb--collapsed' : '')} style={{ width: collapsed ? 60 : 210 }}>
      <style>{`
        /* Sidebar stays on its dark treatment in both themes. */
        .gsb {
          flex-shrink: 0;
          background: #0A1628;
          border-right: 1px solid rgba(255,255,255,0.07);
          height: 100vh;
          position: sticky;
          top: 0;
          display: flex;
          flex-direction: column;
          color: #fff;
          transition: width 0.2s ease;
        }
        .gsb__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .gsb--collapsed .gsb__top { flex-direction: column; gap: 10px; padding: 14px 8px; }
        .gsb__toggle {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.5); font-size: 18px; line-height: 1; padding: 4px;
        }
        .gsb__toggle:hover { color: #fff; }
        .gsb__nav { flex: 1; overflow-y: auto; padding: 6px 0; }
        .gsb__group { margin: 0; }
        .gsb__section {
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 16px 16px 4px 16px;
          margin-top: 4px;
        }
        .gsb__item {
          display: flex; align-items: center; gap: 10px;
          height: 40px; padding: 0 16px;
          color: var(--text-secondary);
          border-left: 3px solid transparent;
          text-decoration: none;
          transition: background 0.15s, color 0.15s;
          position: relative;
        }
        .gsb__item svg { flex-shrink: 0; }
        .gsb__item:hover { background: rgba(255,255,255,0.04); }
        .gsb__item.active {
          border-left: 3px solid #004BC8;
          background: rgba(0,75,200,0.10);
          color: #fff;
          font-weight: 600;
        }
        .gsb__label { font-size: 14px; white-space: nowrap; }
        .gsb--collapsed .gsb__item { padding: 0; justify-content: center; }
        /* Tooltip on hover when collapsed */
        .gsb--collapsed .gsb__item:hover::after {
          content: attr(data-label);
          position: absolute; left: 100%; top: 50%; transform: translateY(-50%);
          margin-left: 10px; white-space: nowrap;
          background: #131C2E; color: #fff; padding: 6px 10px; border-radius: 6px;
          font-size: 12px; border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 4px 14px rgba(0,0,0,0.4); z-index: 50;
        }
        .gsb__user {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.07);
        }
        .gsb--collapsed .gsb__user { justify-content: center; padding: 12px 0; }
        .gsb__usermeta { min-width: 0; }
        .gsb__username {
          font-size: 13px; font-weight: 600; color: #fff;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .gsb__logout { padding: 0 12px 14px; }
        .gsb--collapsed .gsb__logout { padding: 0 8px 14px; }
        .gsb__logout button {
          color: #fff; border-color: rgba(255,255,255,0.2); background: transparent;
        }
        .gsb__logout button:hover { background: rgba(255,255,255,0.06); }
      `}</style>

      {/* Top: full logo (icon + name) when expanded, icon-only when collapsed */}
      <div className="gsb__top">
        <img
          src={collapsed ? logoIconWhite : logoFullWhite}
          alt="GGO — Gulf Global Outsourcing"
          style={{ height: collapsed ? 28 : 40, objectFit: 'contain', display: 'block' }}
        />
        <button
          className="gsb__toggle"
          onClick={toggle}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label="Toggle sidebar"
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Grouped nav */}
      <nav className="gsb__nav">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => i.visible(roleCtx));
          if (items.length === 0) return null;
          return (
            <div className="gsb__group" key={group.label}>
              {!collapsed && <div className="gsb__section">{group.label}</div>}
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    data-label={item.label}
                    className={({ isActive }) => 'gsb__item' + (isActive ? ' active' : '')}
                  >
                    <Icon size={18} />
                    {!collapsed && <span className="gsb__label">{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom: user + logout */}
      <div className="gsb__user">
        <div className="avatar" style={{ width: 34, height: 34, fontSize: 13 }} aria-hidden="true">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile, user?.email)}
        </div>
        {!collapsed && (
          <div className="gsb__usermeta">
            <div className="gsb__username">{displayName}</div>
            <span className="role-badge">{role || '—'}</span>
          </div>
        )}
      </div>
      <div className="gsb__logout">
        <button className="btn btn--ghost btn--sm btn--block" onClick={handleLogout} title="Logout">
          {collapsed ? '⎋' : 'Logout'}
        </button>
      </div>
    </aside>
  );
}
