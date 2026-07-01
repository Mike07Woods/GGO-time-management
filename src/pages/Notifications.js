// src/pages/Notifications.js
// In-app notification inbox for the current user. Lists notifications, supports
// mark-as-read (single + all), and updates live via Supabase realtime.

import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// A small icon per notification type.
const TYPE_ICON = {
  shift: '🗓️',
  announcement: '📣',
  system: '⚙️',
  default: '🔔',
};

export default function Notifications() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!user) return undefined;
    load();

    // Live updates for this user's notifications.
    const channel = supabase
      .channel('notifications-page-' + user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function markRead(id) {
    setError('');
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  }

  async function markAllRead() {
    setError('');
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (error) {
      setError(error.message);
      return;
    }
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  const unread = items.filter((n) => !n.is_read).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>{unread} unread</p>
        </div>
        {unread > 0 && (
          <button className="btn btn--ghost" onClick={markAllRead}>
            Mark all as read
          </button>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <div className="card">
          <div className="empty-state">You're all caught up — no notifications.</div>
        </div>
      ) : (
        items.map((n) => (
          <div key={n.id} className={'list-item' + (n.is_read ? '' : ' list-item--unread')}>
            <div style={{ fontSize: 22 }}>{TYPE_ICON[n.type] || TYPE_ICON.default}</div>
            <div className="list-item__body">
              <div className="row row--between">
                <div className="list-item__title">{n.title}</div>
                {!n.is_read && <span className="dot" />}
              </div>
              {n.body && <div className="muted">{n.body}</div>}
              <div className="list-item__meta row row--between">
                <span>{formatDate(n.created_at)}</span>
                {!n.is_read && (
                  <button className="btn btn--ghost btn--sm" onClick={() => markRead(n.id)}>
                    Mark as read
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
