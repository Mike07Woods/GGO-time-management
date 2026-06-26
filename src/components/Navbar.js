// src/components/Navbar.js
// Top bar: GGO brand lockup (left), theme toggle + notification bell + user (right).

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';
import logoFullWhite from '../assets/ggo-full-white.png';
import logoFullBlack from '../assets/ggo-full-black.png';

// GGO full logo lockup. Swaps white/dark artwork to stay legible on both the
// dark and light navbar.
function BrandLockup({ theme }) {
  return (
    <img
      src={theme === 'light' ? logoFullBlack : logoFullWhite}
      alt="Gulf Global Outsourcing"
      style={{ height: '32px', objectFit: 'contain', display: 'block' }}
    />
  );
}

// Build initials from the profile (e.g. "Jane Doe" -> "JD").
function getInitials(profile, email) {
  const f = profile?.first_name?.[0] || '';
  const l = profile?.last_name?.[0] || '';
  const initials = (f + l).toUpperCase();
  return initials || (email?.[0]?.toUpperCase() ?? '?');
}

export default function Navbar() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [unread, setUnread] = useState(0);

  // Theme toggle (light/dark). Initialized from the body class the no-flash
  // script set on load; toggling updates the body class + localStorage.
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.body.classList.contains('light-mode')
      ? 'light'
      : 'dark'
  );

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.body.className = next === 'light' ? 'light-mode' : 'dark-mode';
    try {
      localStorage.setItem('ggo-theme', next);
    } catch (e) {
      /* ignore storage errors */
    }
  }

  // Load the unread notification count, and keep it live with realtime.
  useEffect(() => {
    if (!user) return undefined;

    let active = true;

    async function loadCount() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (active) setUnread(count || 0);
    }

    loadCount();

    // Realtime: refresh the badge whenever this user's notifications change.
    const channel = supabase
      .channel('navbar-notifications-' + user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        loadCount
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || 'User';

  return (
    <header className="navbar">
      <BrandLockup theme={theme} />

      <div className="navbar__right">
        {/* Light / dark theme toggle (moon in dark, sun in light) */}
        <button className="icon-btn" title="Toggle theme" onClick={toggleTheme}>
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>

        {/* Notification bell with unread badge */}
        <button
          className="navbar__bell"
          title="Notifications"
          onClick={() => navigate('/notifications')}
        >
          🔔
          {unread > 0 && <span className="badge-count">{unread > 99 ? '99+' : unread}</span>}
        </button>

        {/* Current user */}
        <div className="navbar__user">
          <div className="navbar__user-meta">
            <div className="navbar__user-name">{displayName}</div>
            <div className="navbar__user-role">{profile?.role || '—'}</div>
          </div>
          <div className="avatar" aria-hidden="true">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" />
            ) : (
              getInitials(profile, user?.email)
            )}
          </div>
        </div>

        <button className="btn btn--ghost btn--sm" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
