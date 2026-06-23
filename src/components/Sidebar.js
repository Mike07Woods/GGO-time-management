// src/components/Sidebar.js
// Left navigation. Links are filtered by the user's role so people only see
// the sections they're allowed to use.

import React from 'react';
import { NavLink } from 'react-router-dom';
import { useRole } from '../hooks/useRole';

// Each nav item lists the MINIMUM role needed to see it.
// 'user' = visible to everyone who is logged in.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '🏠', minRole: 'user', end: true },
  { to: '/directory', label: 'Directory', icon: '👥', minRole: 'user' },
  { to: '/scheduling', label: 'Scheduling', icon: '🗓️', minRole: 'user' },
  { to: '/timeclock', label: 'Time Clock', icon: '⏱️', minRole: 'user' },
  { to: '/announcements', label: 'Announcements', icon: '📣', minRole: 'user' },
  { to: '/notifications', label: 'Notifications', icon: '🔔', minRole: 'user' },
];

export default function Sidebar() {
  const { role, isAtLeast } = useRole();

  // Keep only the items this role is allowed to see.
  const visibleItems = NAV_ITEMS.filter((item) => isAtLeast(item.minRole));

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">GG</div>
        <div>
          <div className="sidebar__title">GGO</div>
          <div className="sidebar__subtitle">Time Management</div>
        </div>
      </div>

      <nav className="sidebar__nav">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end} // 'end' makes "/" match only the dashboard, not every route
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
          >
            <span className="nav-link__icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        Signed in as <strong style={{ textTransform: 'capitalize' }}>{role || '—'}</strong>
      </div>
    </aside>
  );
}
