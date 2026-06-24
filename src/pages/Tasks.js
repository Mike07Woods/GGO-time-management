// src/pages/Tasks.js
// Phase 2 — Task management with a Kanban board.
//   manager+ : create/assign tasks; move any task.
//   everyone : see tasks assigned to them and advance their own status.
// Columns map to the task.status values pending / in_progress / completed.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

const COLUMNS = [
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
];

// Priority -> badge style + accent colour for the card's left border.
const PRIORITY = {
  low: { badge: 'badge--gray', color: '#6f829b' },
  medium: { badge: 'badge--teal', color: '#009e8e' },
  high: { badge: 'badge--amber', color: '#f0a020' },
  urgent: { badge: 'badge--red', color: '#e5484d' },
};

const PRIORITY_ORDER = ['low', 'medium', 'high', 'urgent'];

const EMPTY_FORM = { title: '', description: '', assigned_to: '', due_date: '', priority: 'medium' };

function formatDue(value) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Tasks() {
  const { user } = useAuth();
  const { isManager } = useRole();

  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Filters
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
    });
    return map;
  }, [people]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [tasksRes, peopleRes] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .eq('is_active', true)
        .order('first_name', { ascending: true }),
    ]);
    if (tasksRes.error) setError(tasksRes.error.message);
    setTasks(tasksRes.data || []);
    setPeople(peopleRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function createTask(e) {
    e.preventDefault();
    setError('');
    if (!form.title) {
      setError('A task needs a title.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: form.title,
        description: form.description || null,
        assigned_to: form.assigned_to || null,
        assigned_by: user.id,
        due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
        priority: form.priority,
        status: 'pending',
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setTasks((prev) => [data, ...prev]);
    setForm(EMPTY_FORM);

    // Notify the assignee (reuses the Phase 1 notifications feature).
    if (data.assigned_to) {
      await supabase.from('notifications').insert({
        user_id: data.assigned_to,
        title: 'New task assigned',
        body: data.title,
        type: 'task',
      });
    }
  }

  async function moveTask(task, status) {
    setError('');
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id);
    if (error) {
      setError(error.message);
      return;
    }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
  }

  // Apply the assignee / priority filters.
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (assigneeFilter !== 'all' && t.assigned_to !== assigneeFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, assigneeFilter, priorityFilter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tasks</h1>
          <p>{isManager ? 'Assign work and track it across the board.' : 'Your assigned tasks.'}</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Create form — manager+ */}
      {isManager && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card__title">Create a task</div>
          <form onSubmit={createTask}>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Restock supplies"
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
                <label>Assign to</label>
                <select
                  className="select"
                  value={form.assigned_to}
                  onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
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
                <label>Priority</label>
                <select
                  className="select"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Due date</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn btn--primary" disabled={saving}>
                  {saving ? 'Creating…' : 'Create task'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          {isManager && (
            <div className="field" style={{ margin: 0, minWidth: 200 }}>
              <label>Assignee</label>
              <select
                className="select"
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                <option value="all">Everyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameById[p.id]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <label>Priority</label>
            <select
              className="select"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="all">All priorities</option>
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <p className="muted">Loading tasks…</p>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {COLUMNS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="card">
                <div className="card__title">
                  <span>{col.label}</span>
                  <span className="badge badge--gray">{colTasks.length}</span>
                </div>

                {colTasks.length === 0 ? (
                  <div className="dim" style={{ fontSize: 13, padding: '8px 0' }}>
                    Nothing here.
                  </div>
                ) : (
                  <div className="stack">
                    {colTasks.map((t) => {
                      const pr = PRIORITY[t.priority] || PRIORITY.medium;
                      const colIndex = COLUMNS.findIndex((c) => c.key === col.key);
                      return (
                        <div
                          key={t.id}
                          className="card"
                          style={{ padding: 12, borderLeft: `3px solid ${pr.color}` }}
                        >
                          <div className="row row--between">
                            <strong>{t.title}</strong>
                            <span className={'badge ' + pr.badge}>{t.priority}</span>
                          </div>
                          {t.description && (
                            <div className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
                              {t.description}
                            </div>
                          )}
                          <div className="dim" style={{ fontSize: 12 }}>
                            {t.assigned_to ? nameById[t.assigned_to] || 'Unknown' : 'Unassigned'}
                            {t.due_date ? ` · due ${formatDue(t.due_date)}` : ''}
                          </div>

                          {/* Move controls (click to update status) */}
                          <div className="row" style={{ gap: 6, marginTop: 8 }}>
                            {colIndex > 0 && (
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => moveTask(t, COLUMNS[colIndex - 1].key)}
                                title="Move back"
                              >
                                ←
                              </button>
                            )}
                            {colIndex < COLUMNS.length - 1 && (
                              <button
                                className="btn btn--primary btn--sm"
                                onClick={() => moveTask(t, COLUMNS[colIndex + 1].key)}
                                title="Move forward"
                              >
                                →
                              </button>
                            )}
                            {isManager && t.status !== 'cancelled' && (
                              <button
                                className="btn btn--danger btn--sm"
                                onClick={() => moveTask(t, 'cancelled')}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
