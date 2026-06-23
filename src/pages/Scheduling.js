// src/pages/Scheduling.js
// Shift scheduling with role-based access:
//   USER            -> sees ONLY shifts assigned to them; no create/manage controls
//   MANAGER         -> can create shifts and assign them to THEIR TEAM (same
//                      department) only; can publish/cancel; cannot delete
//   ADMIN / OWNER   -> can create and assign to anyone; full management

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
  const { user, profile } = useAuth();
  const { canCreate, canEdit, isManager, isAdmin } = useRole();

  const canCreateShift = canCreate('shift'); // manager and above
  const canManageShift = canEdit('shift'); // manager and above (publish/cancel)

  const [shifts, setShifts] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Quick lookup: profile id -> display name (covers every active person).
  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
    });
    return map;
  }, [people]);

  // Who can this actor assign a shift to?
  //   admin/owner -> anyone active
  //   manager     -> only their own team (same department)
  const assignablePeople = useMemo(() => {
    if (isAdmin) return people; // admin + owner: everyone
    if (isManager) {
      // Managers are limited to their team (same department).
      return people.filter((p) => p.department && p.department === profile?.department);
    }
    return [];
  }, [people, isAdmin, isManager, profile]);

  async function loadData() {
    setLoading(true);

    // Shift query — regular users only ever load shifts assigned to them.
    let shiftQuery = supabase.from('shifts').select('*').order('start_time', { ascending: true });
    if (!isManager) {
      shiftQuery = shiftQuery.eq('assigned_to', user.id);
    }

    const [shiftsRes, peopleRes] = await Promise.all([
      shiftQuery,
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, department')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isManager]);

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
    if (!canCreateShift) return; // belt-and-braces guard

    if (!form.title || !form.start_time || !form.end_time) {
      setError('Title, start time and end time are required.');
      return;
    }

    // Managers may only assign within their team.
    if (form.assigned_to && !isAdmin) {
      const allowed = assignablePeople.some((p) => p.id === form.assigned_to);
      if (!allowed) {
        setError('You can only assign shifts to members of your team.');
        return;
      }
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
    if (!canManageShift) return;
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

  // Cancel a shift (a status change, not a delete — managers are allowed to do this).
  async function cancelShift(id) {
    setError('');
    if (!canManageShift) return;
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
          <p>{canCreateShift ? 'Create, assign and publish shifts.' : 'Your assigned shifts.'}</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Create form — only roles that can create shifts (manager and above) */}
      {canCreateShift && (
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
              <label>
                Assign to{!isAdmin && <span className="dim"> (your team)</span>}
              </label>
              <select
                className="select"
                value={form.assigned_to}
                onChange={(e) => updateForm('assigned_to', e.target.value)}
              >
                <option value="">Unassigned</option>
                {assignablePeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameById[p.id]}
                  </option>
                ))}
              </select>
              {!isAdmin && assignablePeople.length === 0 && (
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  No teammates found in your department yet.
                </div>
              )}
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
        <div className="card__title">{canManageShift ? 'All shifts' : 'My shifts'}</div>

        {loading ? (
          <p className="muted">Loading shifts…</p>
        ) : shifts.length === 0 ? (
          <div className="empty-state">
            {canManageShift ? 'No shifts yet.' : 'You have no shifts assigned yet.'}
          </div>
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
                  {/* Actions column only for roles that can manage shifts */}
                  {canManageShift && <th>Actions</th>}
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
                    {canManageShift && (
                      <td>
                        <div className="row">
                          {s.status === 'draft' && (
                            <button
                              className="btn btn--primary btn--sm"
                              onClick={() => publishShift(s)}
                            >
                              Publish
                            </button>
                          )}
                          {s.status !== 'cancelled' && (
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => cancelShift(s.id)}
                            >
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
