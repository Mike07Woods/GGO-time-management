// src/pages/Departments.js
// Owner/Admin: create and manage departments, assign a manager, view members.
// Backed by the `departments` table (see supabase-departments.sql).

import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Pencil, Trash2, Plus, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

const EMPTY_FORM = { name: '', description: '', manager_id: '' };

function personName(p) {
  if (!p) return '—';
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '—';
}

export default function Departments() {
  const toast = useToast();

  const [departments, setDepartments] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);

  // Modal (add / edit) + drawer (members)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [drawerDept, setDrawerDept] = useState(null);

  async function loadData() {
    setLoading(true);
    const [deptRes, peopleRes] = await Promise.all([
      supabase.from('departments').select('*').order('name', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, department_id')
        .eq('is_active', true),
    ]);
    if (deptRes.error) {
      // Most likely the migration hasn't been run yet.
      setMigrationMissing(true);
      setDepartments([]);
    } else {
      setMigrationMissing(false);
      setDepartments(deptRes.data || []);
    }
    setPeople(peopleRes.error ? [] : peopleRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peopleById = useMemo(() => {
    const map = {};
    people.forEach((p) => (map[p.id] = p));
    return map;
  }, [people]);

  const managers = useMemo(() => people.filter((p) => p.role === 'manager'), [people]);

  const membersByDept = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      if (!p.department_id) return;
      (map[p.department_id] = map[p.department_id] || []).push(p);
    });
    return map;
  }, [people]);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(dept) {
    setEditingId(dept.id);
    setForm({ name: dept.name || '', description: dept.description || '', manager_id: dept.manager_id || '' });
    setModalOpen(true);
  }

  async function saveDept(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Department name is required.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      manager_id: form.manager_id || null,
    };
    const resp = editingId
      ? await supabase.from('departments').update(payload).eq('id', editingId).select().single()
      : await supabase.from('departments').insert(payload).select().single();
    setSaving(false);
    if (resp.error) {
      toast.error(resp.error.message);
      return;
    }
    setDepartments((prev) => {
      if (editingId) return prev.map((d) => (d.id === editingId ? resp.data : d));
      return [...prev, resp.data].sort((a, b) => a.name.localeCompare(b.name));
    });
    setModalOpen(false);
    toast.success(editingId ? 'Department updated' : 'Department created');
  }

  async function assignManager(dept, managerId) {
    const prev = dept.manager_id;
    setDepartments((list) => list.map((d) => (d.id === dept.id ? { ...d, manager_id: managerId || null } : d)));
    const { error } = await supabase
      .from('departments')
      .update({ manager_id: managerId || null })
      .eq('id', dept.id);
    if (error) {
      setDepartments((list) => list.map((d) => (d.id === dept.id ? { ...d, manager_id: prev } : d)));
      toast.error(error.message);
      return;
    }
    toast.success('Manager updated');
  }

  async function deleteDept(dept) {
    const count = (membersByDept[dept.id] || []).length;
    if (count > 0) {
      toast.error('Move members first');
      return;
    }
    if (!window.confirm(`Delete "${dept.name}"?`)) return;
    const { error } = await supabase.from('departments').delete().eq('id', dept.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    toast.success('Department deleted');
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Departments</h1>
          <p>Organize your team into departments and assign managers.</p>
        </div>
        <button className="btn btn--primary" onClick={openAdd} disabled={migrationMissing}>
          <Plus size={16} /> Add Department
        </button>
      </div>

      {migrationMissing && (
        <div className="alert alert--error">
          The <code>departments</code> table doesn't exist yet. Run{' '}
          <strong>supabase-departments.sql</strong> in the Supabase SQL Editor, then reload.
        </div>
      )}

      {loading ? (
        <div className="card">
          <SkeletonList />
        </div>
      ) : departments.length === 0 && !migrationMissing ? (
        <div className="card">
          <div className="empty-state">No departments yet — add your first one.</div>
        </div>
      ) : (
        <div className="grid grid--2">
          {departments.map((dept) => {
            const members = membersByDept[dept.id] || [];
            return (
              <div className="card" key={dept.id}>
                <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                  <div className="row" style={{ gap: 10 }}>
                    <Building2 size={20} style={{ color: 'var(--accent-text)' }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{dept.name}</div>
                      {dept.description && (
                        <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
                          {dept.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn--ghost btn--sm" title="Edit" onClick={() => openEdit(dept)}>
                      <Pencil size={15} />
                    </button>
                    <button className="btn btn--danger btn--sm" title="Delete" onClick={() => deleteDept(dept)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="field" style={{ margin: '14px 0 10px' }}>
                  <label>Manager</label>
                  <select
                    className="select"
                    value={dept.manager_id || ''}
                    onChange={(e) => assignManager(dept, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {personName(m)}
                      </option>
                    ))}
                    {/* keep a current non-manager assignee visible */}
                    {dept.manager_id && !managers.some((m) => m.id === dept.manager_id) && (
                      <option value={dept.manager_id}>{personName(peopleById[dept.manager_id])}</option>
                    )}
                  </select>
                </div>

                <div className="row row--between">
                  <span className="badge badge--gray">
                    {members.length} member{members.length === 1 ? '' : 's'}
                  </span>
                  <button className="btn btn--ghost btn--sm" onClick={() => setDrawerDept(dept)}>
                    View Members
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row row--between" style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingId ? 'Edit Department' : 'Add Department'}</h2>
              <button className="btn btn--ghost btn--sm" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={saveDept}>
              <div className="field">
                <label>Name *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Operations"
                  autoFocus
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
              <div className="field">
                <label>Manager</label>
                <select
                  className="select"
                  value={form.manager_id}
                  onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {personName(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Members drawer */}
      {drawerDept && (
        <div className="drawer-backdrop" onClick={() => setDrawerDept(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row row--between" style={{ marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{drawerDept.name}</div>
                <div className="dim" style={{ fontSize: 13 }}>
                  {(membersByDept[drawerDept.id] || []).length} members
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => setDrawerDept(null)}>
                <X size={16} />
              </button>
            </div>
            {(membersByDept[drawerDept.id] || []).length === 0 ? (
              <div className="empty-state">No members in this department.</div>
            ) : (
              <div className="stack">
                {(membersByDept[drawerDept.id] || []).map((m) => (
                  <div key={m.id} className="row" style={{ gap: 10 }}>
                    <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {((m.first_name?.[0] || '') + (m.last_name?.[0] || '')).toUpperCase() || '?'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{personName(m)}</div>
                      <div className="dim" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                        {m.role === 'user' ? 'employee' : m.role}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
