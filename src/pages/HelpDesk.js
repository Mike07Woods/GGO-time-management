// src/pages/HelpDesk.js
// Phase 3 — Help Desk (ticketing).
//   everyone : submit tickets, view their own, comment.
//   manager+ : see all tickets, assign them, change status.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

// Exact priority colours requested in the spec.
const PRIORITY_COLOR = {
  urgent: '#E53E3E',
  high: '#D69E2E',
  medium: '#009E8E',
  low: '#6B7FA3',
};
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const STATUS_BADGE = {
  open: 'badge--gray',
  in_progress: 'badge--amber',
  resolved: 'badge--green',
  closed: 'badge--purple',
};
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const EMPTY = { title: '', description: '', category: '', priority: 'medium' };

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HelpDesk() {
  const { user } = useAuth();
  const { isManager } = useRole();

  const [tickets, setTickets] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const [openId, setOpenId] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Member';
    });
    return map;
  }, [people]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [tRes, pRes] = await Promise.all([
      supabase.from('helpdesk_tickets').select('*').order('created_at', { ascending: false }),
      // Sanitized lookup view — lets regular ticket submitters see assignee /
      // commenter names without access to the full directory.
      supabase
        .from('profiles_public')
        .select('id, first_name, last_name, avatar_url')
        .eq('is_active', true)
        .order('first_name', { ascending: true }),
    ]);
    if (tRes.error) setError(tRes.error.message);
    setTickets(tRes.data || []);
    setPeople(pRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function submitTicket(e) {
    e.preventDefault();
    setError('');
    if (!form.title || !form.description) {
      setError('Title and description are required.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('helpdesk_tickets')
      .insert({
        title: form.title,
        description: form.description,
        category: form.category || null,
        priority: form.priority,
        status: 'open',
        submitted_by: user.id,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setTickets((prev) => [data, ...prev]);
    setForm(EMPTY);
  }

  async function openTicket(ticket) {
    if (openId === ticket.id) {
      setOpenId(null);
      return;
    }
    setOpenId(ticket.id);
    const { data } = await supabase
      .from('helpdesk_comments')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }

  async function addComment(ticketId) {
    const content = commentText.trim();
    if (!content) return;
    setCommentText('');
    const { data, error } = await supabase
      .from('helpdesk_comments')
      .insert({ ticket_id: ticketId, user_id: user.id, content })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    setComments((prev) => [...prev, data]);
  }

  // Manager+ actions: patch a ticket and refresh local state.
  async function patchTicket(ticketId, patch) {
    setError('');
    const { error } = await supabase
      .from('helpdesk_tickets')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', ticketId);
    if (error) {
      setError(error.message);
      return;
    }
    setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...patch } : t)));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Help Desk</h1>
          <p>{isManager ? 'All support tickets.' : 'Your support tickets.'}</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Submit ticket — everyone */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card__title">Submit a ticket</div>
        <form onSubmit={submitTicket}>
          <div className="field">
            <label>Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Short summary"
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label>Category</label>
              <input
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. IT, Facilities"
              />
            </div>
            <div className="field">
              <label>Priority</label>
              <select
                className="select"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn--primary" disabled={saving}>
            {saving ? 'Submitting…' : 'Submit ticket'}
          </button>
        </form>
      </div>

      {/* Ticket list */}
      {loading ? (
        <p className="muted">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <div className="card">
          <div className="empty-state">No tickets yet.</div>
        </div>
      ) : (
        tickets.map((t) => (
          <div key={t.id} className="list-item" style={{ borderLeft: `3px solid ${PRIORITY_COLOR[t.priority]}` }}>
            <div className="list-item__body">
              <div className="row row--between">
                <button
                  onClick={() => openTicket(t)}
                  style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                >
                  <span className="list-item__title">{t.title}</span>
                </button>
                <span className="row" style={{ gap: 8 }}>
                  <span className="badge" style={{ background: 'transparent', border: `1px solid ${PRIORITY_COLOR[t.priority]}`, color: PRIORITY_COLOR[t.priority] }}>
                    {t.priority}
                  </span>
                  <span className={'badge ' + (STATUS_BADGE[t.status] || 'badge--gray')}>
                    {t.status.replace('_', ' ')}
                  </span>
                </span>
              </div>
              <div className="list-item__meta">
                {t.category || 'General'} · by {nameById[t.submitted_by] || 'Unknown'} ·{' '}
                {formatDate(t.created_at)}
                {t.assigned_to ? ` · assigned to ${nameById[t.assigned_to] || 'Unknown'}` : ''}
              </div>

              {/* Expanded detail */}
              {openId === t.id && (
                <div className="card" style={{ marginTop: 12, background: 'var(--navy-700)' }}>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>

                  {/* Manager controls */}
                  {isManager && (
                    <div className="form-row" style={{ marginBottom: 12 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Status</label>
                        <select
                          className="select"
                          value={t.status}
                          onChange={(e) => patchTicket(t.id, { status: e.target.value })}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Assign to</label>
                        <select
                          className="select"
                          value={t.assigned_to || ''}
                          onChange={(e) => patchTicket(t.id, { assigned_to: e.target.value || null })}
                        >
                          <option value="">Unassigned</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {nameById[p.id]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Comments */}
                  <div className="card__title" style={{ fontSize: 14 }}>
                    Comments ({comments.length})
                  </div>
                  <div className="stack" style={{ marginBottom: 12 }}>
                    {comments.length === 0 ? (
                      <p className="dim">No comments yet.</p>
                    ) : (
                      comments.map((c) => (
                        <div key={c.id}>
                          <div className="dim" style={{ fontSize: 12 }}>
                            {nameById[c.user_id] || 'Unknown'} · {formatDate(c.created_at)}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Add a comment…"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addComment(t.id)}
                    />
                    <button className="btn btn--primary" onClick={() => addComment(t.id)}>
                      Post
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
