// src/components/Sidebar.js
// Left navigation. Every item is gated through a `visible()` predicate that
// receives the full role context from useRole(), so menu entries appear/disappear
// based on the signed-in user's role.
//
// Per the access matrix, all four roles may SEE the six core pages (their
// restrictions are enforced inside each page), so those items are visible to
// everyone. Admin/owner-only areas (e.g. user management, settings) use a
// stricter predicate — see the commented example below.

import React from 'react';
import { NavLink } from 'react-router-dom';
import { useRole } from '../hooks/useRole';

// Each item's `visible` receives the useRole() context and returns a boolean.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true, visible: () => true },
  { to: '/directory', label: 'Directory', icon: '👥', visible: () => true },
  { to: '/scheduling', label: 'Scheduling', icon: '🗓️', visible: () => true },
  { to: '/timeclock', label: 'Time Clock', icon: '⏱️', visible: () => true },
  { to: '/announcements', label: 'Announcements', icon: '📣', visible: () => true },
  { to: '/notifications', label: 'Notifications', icon: '🔔', visible: () => true },

  // Example of an admin/owner-only menu entry. Managers and users would NOT see it:
  // { to: '/settings', label: 'Settings', icon: '⚙️', visible: (r) => r.canManageUsers() },
];

export default function Sidebar() {
  const roleCtx = useRole();
  const { role } = roleCtx;

  // Keep only the items whose predicate passes for this role.
  const visibleItems = NAV_ITEMS.filter((item) => item.visible(roleCtx));

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
