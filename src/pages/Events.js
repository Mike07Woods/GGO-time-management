// src/pages/Events.js
// Phase 3 — Events + RSVPs.
//   manager+ : create events.
//   everyone : see events aimed at them, RSVP, view the attendee list.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

const RSVP_OPTIONS = [
  { value: 'attending', label: 'Attending', badge: 'badge--green' },
  { value: 'maybe', label: 'Maybe', badge: 'badge--amber' },
  { value: 'not_attending', label: 'Not Attending', badge: 'badge--red' },
];

const TARGET_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'user', label: 'Users' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Admins' },
  { value: 'owner', label: 'Owners' },
];

const EMPTY = { title: '', description: '', location: '', start_time: '', end_time: '', target_role: '' };

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Events() {
  const { user, profile } = useAuth();
  const { isManager } = useRole();
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const [rsvps, setRsvps] = useState([]); // all rsvps for visible events
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);

  const myRole = profile?.role || 'user';

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Member';
    });
    return map;
  }, [people]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [evRes, pRes] = await Promise.all([
      supabase
        .from('events')
        .select('*')
        .or(`target_role.is.null,target_role.eq.${myRole}`)
        .order('start_time', { ascending: true }),
      // Sanitized lookup view — attendee names are visible to all without
      // exposing the full directory.
      supabase.from('profiles_public').select('id, first_name, last_name, avatar_url').eq('is_active', true),
    ]);
    if (evRes.error) setError(evRes.error.message);
    const evs = evRes.data || [];
    setEvents(evs);
    setPeople(pRes.data || []);

    if (evs.length > 0) {
      const { data: rs } = await supabase
        .from('event_rsvps')
        .select('*')
        .in('event_id', evs.map((e) => e.id));
      setRsvps(rs || []);
    } else {
      setRsvps([]);
    }
    setLoading(false);
  }, [myRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lookups derived from the rsvps list.
  const rsvpInfo = useCallback(
    (eventId) => {
      const forEvent = rsvps.filter((r) => r.event_id === eventId);
      return {
        attending: forEvent.filter((r) => r.status === 'attending'),
        mine: forEvent.find((r) => r.user_id === user.id)?.status || null,
      };
    },
    [rsvps, user.id]
  );

  async function createEvent(e) {
    e.preventDefault();
    setError('');
    if (!form.title || !form.start_time) {
      setError('Title and start time are required.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: form.title,
        description: form.description || null,
        location: form.location || null,
        start_time: new Date(form.start_time).toISOString(),
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
        target_role: form.target_role || null,
        created_by: user.id,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEvents((prev) =>
      [...prev, data].sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    );
    setForm(EMPTY);
    toast.success('Event created');
  }

  // Upsert my RSVP for an event.
  async function rsvp(eventId, status) {
    setError('');
    const { error } = await supabase
      .from('event_rsvps')
      .upsert({ event_id: eventId, user_id: user.id, status }, { onConflict: 'event_id,user_id' });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRsvps((prev) => {
      const without = prev.filter((r) => !(r.event_id === eventId && r.user_id === user.id));
      return [...without, { event_id: eventId, user_id: user.id, status }];
    });
    toast.success('RSVP saved');
  }

  const now = useMemo(() => new Date(), []);
  const visible = useMemo(() => {
    return events.filter((e) => {
      const isPast = new Date(e.start_time) < now;
      return tab === 'past' ? isPast : !isPast;
    });
  }, [events, tab, now]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Events</h1>
          <p>Company events and RSVPs.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={'btn btn--sm ' + (tab === 'upcoming' ? 'btn--primary' : 'btn--ghost')}
            onClick={() => setTab('upcoming')}
          >
            Upcoming
          </button>
          <button
            className={'btn btn--sm ' + (tab === 'past' ? 'btn--primary' : 'btn--ghost')}
            onClick={() => setTab('past')}
          >
            Past
          </button>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Create event — manager+ */}
      {isManager && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card__title">Create an event</div>
          <form onSubmit={createEvent}>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Quarterly Town Hall"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label>Location</label>
                <input
                  className="input"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Main Hall / Zoom"
                />
              </div>
              <div className="field">
                <label>Audience</label>
                <select
                  className="select"
                  value={form.target_role}
                  onChange={(e) => setForm({ ...form, target_role: e.target.value })}
                >
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Start</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                />
              </div>
              <div className="field">
                <label>End</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn--primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create event'}
            </button>
          </form>
        </div>
      )}

      {/* Event list */}
      {loading ? (
        <SkeletonList />
      ) : visible.length === 0 ? (
        <div className="card">
          <div className="empty-state">No {tab} events.</div>
        </div>
      ) : (
        visible.map((ev) => {
          const info = rsvpInfo(ev.id);
          return (
            <div key={ev.id} className="list-item">
              <div className="list-item__body">
                <div className="row row--between">
                  <div className="list-item__title">{ev.title}</div>
                  <span className="badge badge--teal">{info.attending.length} attending</span>
                </div>
                <div className="list-item__meta">
                  📅 {formatDateTime(ev.start_time)}
                  {ev.location ? ` · 📍 ${ev.location}` : ''}
                  {ev.target_role ? ` · ${ev.target_role}` : ''}
                </div>
                {ev.description && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {ev.description}
                  </div>
                )}

                {/* RSVP buttons */}
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {RSVP_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      className={'btn btn--sm ' + (info.mine === o.value ? 'btn--primary' : 'btn--ghost')}
                      onClick={() => rsvp(ev.id, o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setOpenId(openId === ev.id ? null : ev.id)}
                  >
                    {openId === ev.id ? 'Hide attendees' : 'View attendees'}
                  </button>
                </div>

                {/* Attendee list */}
                {openId === ev.id && (
                  <div className="card" style={{ marginTop: 10, background: 'var(--navy-700)' }}>
                    <div className="card__title" style={{ fontSize: 14 }}>
                      Attending ({info.attending.length})
                    </div>
                    {info.attending.length === 0 ? (
                      <p className="dim">No one has confirmed yet.</p>
                    ) : (
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {info.attending.map((r) => (
                          <span key={r.user_id} className="badge badge--gray">
                            {nameById[r.user_id] || 'Unknown'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
