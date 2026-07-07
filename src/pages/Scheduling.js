// src/pages/Scheduling.js
// Shift scheduling with role-based access:
//   USER            -> sees ONLY shifts assigned to them; no create/manage controls
//   MANAGER         -> can create shifts and assign them to THEIR TEAM (same
//                      department) only; can publish/cancel; cannot delete
//   ADMIN / OWNER   -> can create and assign to anyone; full management

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarX, Send, Ban } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

// Status -> presence-style dot colour.
const STATUS_DOT = { draft: 'var(--amber)', published: 'var(--green)', cancelled: 'var(--red)' };

function shiftDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function shiftTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

const EMPTY_FORM = { title: '', assigned_to: '', start_time: '', end_time: '', location: '' };

export default function Scheduling() {
  const { user, profile } = useAuth();
  const { canCreate, canEdit, isManager, isAdmin } = useRole();
  const toast = useToast();

  const canCreateShift = canCreate('shift'); // manager and above
  const canManageShift = canEdit('shift'); // manager and above (publish/cancel)

  const [shifts, setShifts] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
    });
    return map;
  }, [people]);

  const avatarById = useMemo(() => {
    const map = {};
    people.forEach((p) => (map[p.id] = p.avatar_url));
    return map;
  }, [people]);

  const assignablePeople = useMemo(() => {
    if (isAdmin) return people;
    if (isManager) return people.filter((p) => p.department && p.department === profile?.department);
    return [];
  }, [people, isAdmin, isManager, profile]);

  async function loadData() {
    setLoading(true);
    let shiftQuery = supabase.from('shifts').select('*').order('start_time', { ascending: true });
    if (!isManager) shiftQuery = shiftQuery.eq('assigned_to', user.id);

    const [shiftsRes, peopleRes] = await Promise.all([
      shiftQuery,
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, department, avatar_url')
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

  async function notifyAssignee(shift) {
    if (!shift.assigned_to) return;
    await supabase.from('notifications').insert({
      user_id: shift.assigned_to,
      title: 'New shift published',
      body: `${shift.title || 'A shift'} on ${formatDateTime(shift.start_time)}`,
      type: 'shift',
    });
  }

  async function createShift(publish) {
    setError('');
    if (!canCreateShift) return;
    if (!form.title || !form.start_time || !form.end_time) {
      setError('Title, start time and end time are required.');
      return;
    }
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
      start_time: new Date(form.start_time).toISOString(),
      end_time: new Date(form.end_time).toISOString(),
      location: form.location || null,
      status: publish ? 'published' : 'draft',
      created_by: user.id,
    };

    const { data, error } = await supabase.from('shifts').insert(payload).select().single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setShifts((prev) => [...prev, data].sort((a, b) => new Date(a.start_time) - new Date(b.start_time)));
    setForm(EMPTY_FORM);
    toast.success(publish ? 'Shift published' : 'Draft saved');
    if (publish) await notifyAssignee(data);
  }

  async function publishShift(shift) {
    setError('');
    if (!canManageShift) return;
    const { error } = await supabase.from('shifts').update({ status: 'published' }).eq('id', shift.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setShifts((prev) => prev.map((s) => (s.id === shift.id ? { ...s, status: 'published' } : s)));
    toast.success('Shift published');
    await notifyAssignee(shift);
  }

  async function cancelShift(id) {
    setError('');
    if (!canManageShift) return;
    const { error } = await supabase.from('shifts').update({ status: 'cancelled' }).eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'cancelled' } : s)));
    toast.info('Shift cancelled');
  }

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return shifts;
    return shifts.filter((s) => s.status === statusFilter);
  }, [shifts, statusFilter]);

  const scoped = `
    .sched-grid { display: grid; grid-template-columns: 38% 1fr; gap: 16px; align-items: start; }
    @media (max-width: 900px) { .sched-grid { grid-template-columns: 1fr; } }
    .sched-form .field { margin-bottom: 12px; }
    .sched-tabs { display: inline-flex; gap: 4px; background: var(--surface-2); padding: 3px; border-radius: var(--radius-sm); }
    .sched-tab { border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
    .sched-tab.active { background: var(--surface); color: var(--text-primary); box-shadow: var(--shadow-sm); }
    .sched-row { display: grid; grid-template-columns: 12px 1.5fr 1.3fr 1.2fr 1fr auto; gap: 12px; align-items: center; min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
    .sched-row:last-child { border-bottom: none; }
    .sched-dot { width: 8px; height: 8px; border-radius: 50%; }
    .sched-assignee { display: flex; align-items: center; gap: 8px; min-width: 0; }
    @media (max-width: 640px) { .sched-row { grid-template-columns: 12px 1fr auto; } .sched-row .sched-hide { display: none; } }
  `;

  const TABS = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'draft', label: 'Draft' },
  ];

  const shiftList = (
    <>
      <div className="card__title" style={{ justifyContent: 'space-between' }}>
        <span>{canManageShift ? 'All Shifts' : 'My Shifts'}</span>
        <div className="sched-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'sched-tab' + (statusFilter === t.key ? ' active' : '')}
              onClick={() => setStatusFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
          <CalendarX size={26} style={{ marginBottom: 8, opacity: 0.7 }} />
          <div style={{ fontSize: 14 }}>No shifts yet</div>
        </div>
      ) : (
        <div>
          {filtered.map((s) => {
            const who = s.assigned_to ? nameById[s.assigned_to] || 'Unknown' : 'Unassigned';
            const av = s.assigned_to ? avatarById[s.assigned_to] : null;
            return (
              <div key={s.id} className="sched-row">
                <span className="sched-dot" style={{ background: STATUS_DOT[s.status] || 'var(--text-muted)' }} title={s.status} />
                <div style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.title || 'Shift'}
                </div>
                <div className="sched-assignee sched-hide">
                  {s.assigned_to && (
                    <div className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
                      {av ? <img src={av} alt="" /> : initials(who)}
                    </div>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
                </div>
                <div className="sched-hide">
                  <div>{shiftDate(s.start_time)}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {shiftTime(s.start_time)}–{shiftTime(s.end_time)}
                  </div>
                </div>
                <div className="sched-hide dim">{s.location || '—'}</div>
                <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {canManageShift ? (
                    <>
                      {s.status === 'draft' && (
                        <button className="btn--icon" title="Publish" onClick={() => publishShift(s)} style={{ color: 'var(--green)' }}>
                          <Send size={16} />
                        </button>
                      )}
                      {s.status !== 'cancelled' && (
                        <button className="btn--icon" title="Cancel shift" onClick={() => cancelShift(s.id)} style={{ color: 'var(--red)' }}>
                          <Ban size={16} />
                        </button>
                      )}
                    </>
                  ) : (
                    <span className={'badge badge--' + (s.status === 'published' ? 'green' : s.status === 'draft' ? 'amber' : 'red')}>
                      {s.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div>
      <style>{scoped}</style>

      <div className="page-header">
        <div>
          <h1>
            <CalendarDays size={20} /> Shift Scheduling
          </h1>
          <p>{canCreateShift ? 'Create, assign and publish shifts.' : 'Your assigned shifts.'}</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {canCreateShift ? (
        <div className="sched-grid">
          {/* Create form */}
          <div className="card sched-form">
            <div className="card__title" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              New Shift
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
                Fill in the details below
              </span>
            </div>

            <div className="field">
              <label>Title</label>
              <input className="input" value={form.title} onChange={(e) => updateForm('title', e.target.value)} placeholder="e.g. Morning Front Desk" />
            </div>

            <div className="field">
              <label>Assign to{!isAdmin && <span className="dim"> (your team)</span>}</label>
              <select className="select" value={form.assigned_to} onChange={(e) => updateForm('assigned_to', e.target.value)}>
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
              <input className="input" value={form.location} onChange={(e) => updateForm('location', e.target.value)} placeholder="e.g. HQ — Floor 2" />
            </div>

            <div className="field">
              <label>Start time</label>
              <input type="datetime-local" className="input" value={form.start_time} onChange={(e) => updateForm('start_time', e.target.value)} />
            </div>

            <div className="field">
              <label>End time</label>
              <input type="datetime-local" className="input" value={form.end_time} onChange={(e) => updateForm('end_time', e.target.value)} />
            </div>

            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button className="btn btn--primary" disabled={saving} onClick={() => createShift(true)}>
                {saving ? 'Saving…' : 'Publish'}
              </button>
              <button className="btn btn--ghost" disabled={saving} onClick={() => createShift(false)}>
                Save draft
              </button>
            </div>
          </div>

          {/* Shift list */}
          <div className="card">{shiftList}</div>
        </div>
      ) : (
        <div className="card">{shiftList}</div>
      )}
    </div>
  );
}
