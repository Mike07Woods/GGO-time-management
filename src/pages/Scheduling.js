// src/pages/Scheduling.js
// Shift scheduling. Everyone can view shifts; managers+ can create, publish and
// cancel them. Publishing a shift sends the assignee an in-app notification.

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

// Map a shift status to a badge style.
const STATUS_BADGE = {
  draft: 'badge--gray',
  published: 'badge--teal',
  cancelled: 'badge--red',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// An empty create-form object.
const EMPTY_FORM = { title: '', assigned_to: '', start_time: '', end_time: '', location: '' };

export default function Scheduling() {
  const { user } = useAuth();
  const { isManager } = useRole(); // manager, admin, owner can manage shifts

  const [shifts, setShifts] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Quick lookup: profile id -> display name.
  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
    });
    return map;
  }, [people]);

  async function loadData() {
    setLoading(true);

    const [shiftsRes, peopleRes] = await Promise.all([
      supabase.from('shifts').select('*').order('start_time', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .eq('is_active', true)
        .order('first_name', { ascending: true }),
    ]);

    if (shiftsRes.error) setError(shiftsRes.error.message);
    setShifts(shiftsRes.data || []);
    setPeople(peopleRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Send the assignee an in-app notification (best-effort).
  async function notifyAssignee(shift) {
    if (!shift.assigned_to) return;
    await supabase.from('notifications').insert({
      user_id: shift.assigned_to,
      title: 'New shift published',
      body: `${shift.title || 'A shift'} on ${formatDateTime(shift.start_time)}`,
      type: 'shift',
    });
  }

  // Create a shift, either as a draft or published immediately.
  async function createShift(publish) {
    setError('');

    if (!form.title || !form.start_time || !form.end_time) {
      setError('Title, start time and end time are required.');
      return;
    }

    setSaving(true);

    const payload = {
      title: form.title,
      assigned_to: form.assigned_to || null,
      // datetime-local gives local time; store as ISO (UTC).
      start_time: new Date(form.start_time).toISOString(),
      end_time: new Date(form.end_time).toISOString(),
      location: form.location || null,
      status: publish ? 'published' : 'draft',
      created_by: user.id,
    };

    const { data, error } = await supabase.from('shifts').insert(payload).select().single();

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setShifts((prev) =>
      [...prev, data].sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    );
    setForm(EMPTY_FORM);

    if (publish) await notifyAssignee(data);
  }

  // Publish an existing draft.
  async function publishShift(shift) {
    setError('');
    const { error } = await supabase
      .from('shifts')
      .update({ status: 'published' })
      .eq('id', shift.id);
    if (error) {
      setError(error.message);
      return;
    }
    setShifts((prev) => prev.map((s) => (s.id === shift.id ? { ...s, status: 'published' } : s)));
    await notifyAssignee(shift);
  }

  // Cancel a shift.
  async function cancelShift(id) {
    setError('');
    const { error } = await supabase.from('shifts').update({ status: 'cancelled' }).eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'cancelled' } : s)));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Shift Scheduling</h1>
          <p>{isManager ? 'Create, assign and publish shifts.' : 'Your assigned shifts.'}</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Create form — managers and above only */}
      {isManager && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card__title">Create a shift</div>

          <div className="field">
            <label>Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => updateForm('title', e.target.value)}
              placeholder="e.g. Morning Front Desk"
            />
          </div>

          <div className="form-row">
            <div className="field">
              <label>Assign to</label>
              <select
                className="select"
                value={form.assigned_to}
                onChange={(e) => updateForm('assigned_to', e.target.value)}
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameById[p.id]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Location</label>
              <input
                className="input"
                value={form.location}
                onChange={(e) => updateForm('location', e.target.value)}
                placeholder="e.g. HQ — Floor 2"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Start time</label>
              <input
                type="datetime-local"
                className="input"
                value={form.start_time}
                onChange={(e) => updateForm('start_time', e.target.value)}
              />
            </div>
            <div className="field">
              <label>End time</label>
              <input
                type="datetime-local"
                className="input"
                value={form.end_time}
                onChange={(e) => updateForm('end_time', e.target.value)}
              />
            </div>
          </div>

          <div className="row">
            <button className="btn btn--ghost" disabled={saving} onClick={() => createShift(false)}>
              Save as draft
            </button>
            <button className="btn btn--primary" disabled={saving} onClick={() => createShift(true)}>
              {saving ? 'Saving…' : 'Publish shift'}
            </button>
          </div>
        </div>
      )}

      {/* Shift list */}
      <div className="card">
        <div className="card__title">All shifts</div>

        {loading ? (
          <p className="muted">Loading shifts…</p>
        ) : shifts.length === 0 ? (
          <div className="empty-state">No shifts yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Assigned to</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Location</th>
                  <th>Status</th>
                  {isManager && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.title || 'Shift'}</td>
                    <td>{s.assigned_to ? nameById[s.assigned_to] || 'Unknown' : 'Unassigned'}</td>
                    <td>{formatDateTime(s.start_time)}</td>
                    <td>{formatDateTime(s.end_time)}</td>
                    <td>{s.location || '—'}</td>
                    <td>
                      <span className={'badge ' + (STATUS_BADGE[s.status] || 'badge--gray')}>
                        {s.status}
                      </span>
                    </td>
                    {isManager && (
                      <td>
                        <div className="row">
                          {s.status === 'draft' && (
                            <button className="btn btn--primary btn--sm" onClick={() => publishShift(s)}>
                              Publish
                            </button>
                          )}
                          {s.status !== 'cancelled' && (
                            <button className="btn btn--danger btn--sm" onClick={() => cancelShift(s.id)}>
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    )}
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
