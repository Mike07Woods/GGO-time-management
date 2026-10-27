// src/pages/Departments.js
// Owner/Admin: create and manage departments, assign one or more managers, view
// members. Backed by `departments` (supabase-departments.sql) and the
// `department_managers` join table (supabase-department-managers.sql).

import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Pencil, Trash2, Plus, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';
import { useRole } from '../hooks/useRole';

const EMPTY_FORM = { name: '', description: '' };

function personName(p) {
  if (!p) return '—';
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '—';
}

export default function Departments() {
  const toast = useToast();
  const { canManageUser } = useRole();

  const [departments, setDepartments] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [managersMissing, setManagersMissing] = useState(false);
  const [deptManagers, setDeptManagers] = useState([]); // [{department_id, user_id}]

  // Modal (add / edit) + drawer (members)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [drawerDept, setDrawerDept] = useState(null);

  async function loadData() {
    setLoading(true);
    const [deptRes, peopleRes, mgrRes] = await Promise.all([
      supabase.from('departments').select('*').order('name', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, department_id')
        .eq('is_active', true),
      supabase.from('department_managers').select('department_id, user_id'),
    ]);
    setManagersMissing(!!mgrRes.error);
    setDeptManagers(mgrRes.error ? [] : mgrRes.data || []);
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

  const deptName = useMemo(() => {
    const map = {};
    departments.forEach((d) => (map[d.id] = d.name));
    return map;
  }, [departments]);

  const managers = useMemo(() => people.filter((p) => p.role === 'manager'), [people]);

  const managersByDept = useMemo(() => {
    const map = {};
    deptManagers.forEach((m) => (map[m.department_id] = map[m.department_id] || []).push(m.user_id));
    return map;
  }, [deptManagers]);

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
    setForm({ name: dept.name || '', description: dept.description || '' });
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

  async function addManager(dept, userId) {
    if (!userId) return;
    const row = { department_id: dept.id, user_id: userId };
    setDeptManagers((list) => [...list, row]);
    const { error } = await supabase.from('department_managers').insert(row);
    if (error) {
      setDeptManagers((list) => list.filter((m) => !(m.department_id === dept.id && m.user_id === userId)));
      toast.error(error.message);
      return;
    }
    toast.success('Manager added');
  }

  async function removeManager(dept, userId) {
    setDeptManagers((list) => list.filter((m) => !(m.department_id === dept.id && m.user_id === userId)));
    const { error } = await supabase
      .from('department_managers')
      .delete()
      .eq('department_id', dept.id)
      .eq('user_id', userId);
    if (error) {
      setDeptManagers((list) => [...list, { department_id: dept.id, user_id: userId }]);
      toast.error(error.message);
      return;
    }
    toast.success('Manager removed');
  }

  // Move a person into (or, with deptId = null, out of) a department. RLS and the
  // profiles trigger already stop admins touching admin/owner rows; canManageUser
  // mirrors that so the UI never offers an action the database would reject.
  async function setMemberDepartment(person, deptId) {
    if (person.role === 'monitor' && !deptId) {
      toast.error('Monitors must belong to a department. Move them to another one instead.');
      return;
    }
    const prev = person.department_id;
    setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, department_id: deptId } : p)));
    const { error } = await supabase.from('profiles').update({ department_id: deptId }).eq('id', person.id);
    if (error) {
      setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, department_id: prev } : p)));
      toast.error(error.message);
      return;
    }
    toast.success(deptId ? 'Member added' : 'Member removed');
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
          <h1><Building2 size={20} /> Departments</h1>
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

      {managersMissing && !migrationMissing && (
        <div className="alert alert--error">
          Multiple managers need a one-time setup. Run <strong>supabase-department-managers.sql</strong> in
          the Supabase SQL Editor, then reload.
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
                  <label>Managers</label>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {(managersByDept[dept.id] || []).length === 0 && <span className="dim">Unassigned</span>}
                    {(managersByDept[dept.id] || []).map((uid) => (
                      <span key={uid} className="badge badge--teal" style={{ display: 'inline-flex', gap: 4 }}>
                        {personName(peopleById[uid])}
                        <button
                          type="button"
                          title="Remove manager"
                          onClick={() => removeManager(dept, uid)}
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <select
                    className="select"
                    value=""
                    disabled={managersMissing}
                    onChange={(e) => addManager(dept, e.target.value)}
                  >
                    <option value="">Add a manager…</option>
                    {managers
                      .filter((m) => !(managersByDept[dept.id] || []).includes(m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {personName(m)}
                        </option>
                      ))}
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
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Add member</label>
              <select
                className="select"
                value=""
                onChange={(e) => {
                  const person = peopleById[e.target.value];
                  if (person) setMemberDepartment(person, drawerDept.id);
                }}
              >
                <option value="">Select a person…</option>
                {people
                  .filter((p) => p.department_id !== drawerDept.id && canManageUser(p.role))
                  .sort((a, b) => personName(a).localeCompare(personName(b)))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)}
                      {p.department_id ? ` (currently ${deptName[p.department_id] || 'another department'})` : ''}
                    </option>
                  ))}
              </select>
            </div>
            {(membersByDept[drawerDept.id] || []).length === 0 ? (
              <div className="empty-state">No members in this department.</div>
            ) : (
              <div className="stack">
                {(membersByDept[drawerDept.id] || []).map((m) => (
                  <div key={m.id} className="row row--between" style={{ gap: 10 }}>
                    <div className="row" style={{ gap: 10 }}>
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
                    {canManageUser(m.role) && m.role !== 'monitor' && (
                      <button
                        className="btn btn--ghost btn--sm"
                        title="Remove from department"
                        onClick={() => setMemberDepartment(m, null)}
                      >
                        <X size={14} />
                      </button>
                    )}
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
