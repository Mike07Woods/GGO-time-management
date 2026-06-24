// src/pages/Forms.js
// Phase 2 — Forms & checklists.
//   owner/admin: build forms (text / dropdown / checkbox fields), mark mandatory,
//                target a role, and view submissions.
//   everyone:    see forms aimed at them and submit responses.
// Field definitions live in forms.fields (jsonb); answers in form_submissions.answers.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

const TARGET_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'user', label: 'Users' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Admins' },
  { value: 'owner', label: 'Owners' },
];

// Simple unique-ish key for a new field (no Math.random — derive from index + label).
function fieldKey(label, index) {
  const base = (label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${base || 'field'}_${index}`;
}

export default function Forms() {
  const { user, profile } = useAuth();
  const { canCreate } = useRole();
  const canBuild = canCreate('form'); // owner/admin

  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Builder state
  const [meta, setMeta] = useState({ title: '', description: '', is_mandatory: false, target_role: '' });
  const [fields, setFields] = useState([]);
  const [draftField, setDraftField] = useState({ label: '', type: 'text', options: '' });
  const [saving, setSaving] = useState(false);

  // Fill / submissions state
  const [activeForm, setActiveForm] = useState(null); // form being filled
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submissionsFor, setSubmissionsFor] = useState(null); // form id whose submissions are open
  const [submissions, setSubmissions] = useState([]);
  const [mySubmittedIds, setMySubmittedIds] = useState(new Set());

  const myRole = profile?.role || 'user';

  const loadForms = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('forms')
      .select('*')
      .or(`target_role.is.null,target_role.eq.${myRole}`)
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    setForms(data || []);

    // Which forms have I already submitted?
    const subs = await supabase
      .from('form_submissions')
      .select('form_id')
      .eq('submitted_by', user.id);
    setMySubmittedIds(new Set((subs.data || []).map((s) => s.form_id)));
    setLoading(false);
  }, [myRole, user.id]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  // ---- Builder ----
  function addField() {
    if (!draftField.label) return;
    const opts =
      draftField.type === 'dropdown'
        ? draftField.options.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    setFields((prev) => [
      ...prev,
      { key: fieldKey(draftField.label, prev.length), label: draftField.label, type: draftField.type, options: opts },
    ]);
    setDraftField({ label: '', type: 'text', options: '' });
  }

  function removeField(key) {
    setFields((prev) => prev.filter((f) => f.key !== key));
  }

  async function saveForm(e) {
    e.preventDefault();
    setError('');
    if (!meta.title || fields.length === 0) {
      setError('A form needs a title and at least one field.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('forms')
      .insert({
        title: meta.title,
        description: meta.description || null,
        fields,
        is_mandatory: meta.is_mandatory,
        target_role: meta.target_role || null,
        created_by: user.id,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForms((prev) => [data, ...prev]);
    setMeta({ title: '', description: '', is_mandatory: false, target_role: '' });
    setFields([]);
  }

  // ---- Fill & submit ----
  function openForm(form) {
    setActiveForm(form);
    const blank = {};
    (form.fields || []).forEach((f) => {
      blank[f.key] = f.type === 'checkbox' ? false : '';
    });
    setAnswers(blank);
    setSubmissionsFor(null);
  }

  async function submitForm() {
    setSubmitting(true);
    setError('');
    const { error } = await supabase.from('form_submissions').insert({
      form_id: activeForm.id,
      submitted_by: user.id,
      answers,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMySubmittedIds((prev) => new Set(prev).add(activeForm.id));
    setActiveForm(null);
    setAnswers({});
  }

  // ---- Submissions (owner/admin) ----
  async function openSubmissions(form) {
    setActiveForm(null);
    setSubmissionsFor(form.id);
    const { data } = await supabase
      .from('form_submissions')
      .select('*')
      .eq('form_id', form.id)
      .order('submitted_at', { ascending: false });
    setSubmissions(data || []);
  }

  const activeFields = useMemo(() => activeForm?.fields || [], [activeForm]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Forms &amp; Checklists</h1>
          <p>{canBuild ? 'Build forms and review submissions.' : 'Complete the forms assigned to you.'}</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Builder — owner/admin only */}
      {canBuild && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card__title">Create a form</div>
          <form onSubmit={saveForm}>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                placeholder="e.g. Daily Safety Checklist"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                className="input"
                value={meta.description}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <div className="form-row">
              <div className="field">
                <label>Audience</label>
                <select
                  className="select"
                  value={meta.target_role}
                  onChange={(e) => setMeta({ ...meta, target_role: e.target.value })}
                >
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={meta.is_mandatory}
                    onChange={(e) => setMeta({ ...meta, is_mandatory: e.target.checked })}
                  />
                  Mandatory form
                </label>
              </div>
            </div>

            {/* Field builder */}
            <div className="card" style={{ background: 'var(--navy-700)', marginBottom: 14 }}>
              <div className="card__title" style={{ fontSize: 14 }}>Fields</div>
              {fields.length === 0 ? (
                <p className="dim" style={{ marginBottom: 12 }}>No fields yet — add one below.</p>
              ) : (
                <div className="stack" style={{ marginBottom: 12 }}>
                  {fields.map((f) => (
                    <div key={f.key} className="row row--between">
                      <span>
                        <strong>{f.label}</strong>{' '}
                        <span className="badge badge--gray">{f.type}</span>
                        {f.type === 'dropdown' && (
                          <span className="dim"> [{f.options.join(', ')}]</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => removeField(f.key)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-row">
                <div className="field">
                  <label>Field label</label>
                  <input
                    className="input"
                    value={draftField.label}
                    onChange={(e) => setDraftField({ ...draftField, label: e.target.value })}
                    placeholder="e.g. Equipment checked?"
                  />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select
                    className="select"
                    value={draftField.type}
                    onChange={(e) => setDraftField({ ...draftField, type: e.target.value })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {draftField.type === 'dropdown' && (
                <div className="field">
                  <label>Options (comma separated)</label>
                  <input
                    className="input"
                    value={draftField.options}
                    onChange={(e) => setDraftField({ ...draftField, options: e.target.value })}
                    placeholder="Yes, No, N/A"
                  />
                </div>
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={addField}>
                + Add field
              </button>
            </div>

            <button className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create form'}
            </button>
          </form>
        </div>
      )}

      {/* Forms list */}
      {loading ? (
        <p className="muted">Loading forms…</p>
      ) : forms.length === 0 ? (
        <div className="card">
          <div className="empty-state">No forms available.</div>
        </div>
      ) : (
        forms.map((form) => {
          const submitted = mySubmittedIds.has(form.id);
          return (
            <div
              key={form.id}
              className={'list-item' + (form.is_mandatory && !submitted ? ' list-item--unread' : '')}
            >
              <div className="list-item__body">
                <div className="row row--between">
                  <div className="list-item__title">
                    {form.title}{' '}
                    {form.is_mandatory && <span className="badge badge--red">Mandatory</span>}{' '}
                    {submitted && <span className="badge badge--green">✓ Submitted</span>}
                  </div>
                  <span className={'badge ' + (form.target_role ? 'badge--purple' : 'badge--gray')}>
                    {form.target_role || 'everyone'}
                  </span>
                </div>
                {form.description && <div className="muted">{form.description}</div>}

                <div className="list-item__meta row" style={{ gap: 10 }}>
                  <button className="btn btn--primary btn--sm" onClick={() => openForm(form)}>
                    {submitted ? 'Submit again' : 'Fill out'}
                  </button>
                  {canBuild && (
                    <button className="btn btn--ghost btn--sm" onClick={() => openSubmissions(form)}>
                      View submissions
                    </button>
                  )}
                </div>

                {/* Inline fill panel */}
                {activeForm?.id === form.id && (
                  <div className="card" style={{ marginTop: 12, background: 'var(--navy-700)' }}>
                    {activeFields.map((f) => (
                      <div className="field" key={f.key}>
                        <label>{f.label}</label>
                        {f.type === 'text' && (
                          <input
                            className="input"
                            value={answers[f.key] || ''}
                            onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                          />
                        )}
                        {f.type === 'dropdown' && (
                          <select
                            className="select"
                            value={answers[f.key] || ''}
                            onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                          >
                            <option value="">Select…</option>
                            {f.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        )}
                        {f.type === 'checkbox' && (
                          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!!answers[f.key]}
                              onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.checked })}
                            />
                            Yes
                          </label>
                        )}
                      </div>
                    ))}
                    <div className="row">
                      <button className="btn btn--primary" disabled={submitting} onClick={submitForm}>
                        {submitting ? 'Submitting…' : 'Submit'}
                      </button>
                      <button className="btn btn--ghost" onClick={() => setActiveForm(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline submissions panel (owner/admin) */}
                {submissionsFor === form.id && (
                  <div className="card" style={{ marginTop: 12, background: 'var(--navy-700)' }}>
                    <div className="card__title" style={{ fontSize: 14 }}>
                      Submissions ({submissions.length})
                    </div>
                    {submissions.length === 0 ? (
                      <p className="dim">No submissions yet.</p>
                    ) : (
                      <div className="stack">
                        {submissions.map((s) => (
                          <div key={s.id} className="list-item">
                            <div className="list-item__body">
                              <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
                                {new Date(s.submitted_at).toLocaleString()}
                              </div>
                              {(form.fields || []).map((f) => (
                                <div key={f.key}>
                                  <strong>{f.label}:</strong>{' '}
                                  {typeof s.answers?.[f.key] === 'boolean'
                                    ? s.answers[f.key]
                                      ? 'Yes'
                                      : 'No'
                                    : s.answers?.[f.key] || '—'}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: 10 }}
                      onClick={() => setSubmissionsFor(null)}
                    >
                      Close
                    </button>
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
