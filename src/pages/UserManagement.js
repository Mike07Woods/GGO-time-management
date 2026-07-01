// src/pages/UserManagement.js
// Owner-only user management: change roles + department assignments from inline
// dropdowns and soft-remove users — no need to touch Supabase directly.
// The /users route is owner-gated in App.js; the DB enforces the same via RLS +
// the enforce_profile_update trigger.

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

// UI labels map "employee" -> the DB's 'user' role.
const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'user', label: 'Employee' },
];

const ROLE_STYLE = {
  owner: { background: 'rgba(91,63,217,0.15)', color: '#b3a4f5', borderColor: 'rgba(91,63,217,0.45)' },
  admin: { background: 'rgba(0,75,200,0.15)', color: '#6fa0ff', borderColor: 'rgba(0,75,200,0.45)' },
  manager: { background: 'rgba(0,158,142,0.15)', color: '#4fd6c6', borderColor: 'rgba(0,158,142,0.45)' },
  user: { background: 'rgba(159,176,197,0.12)', color: '#a0aec0', borderColor: 'var(--border-color)' },
};

function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}

function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || '—';
}

export default function UserManagement() {
  const { user } = useAuth();
  const toast = useToast();

  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState(null);

  async function loadData() {
    setLoading(true);
    const [peopleRes, deptRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, is_active, department_id')
        .eq('is_active', true)
        .order('first_name', { ascending: true }),
      // departments may not exist until the migration is run — fail quietly.
      supabase.from('departments').select('id, name').order('name', { ascending: true }),
    ]);
    if (peopleRes.error) toast.error(peopleRes.error.message);
    setPeople(peopleRes.data || []);
    setDepartments(deptRes.error ? [] : deptRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deptName = useMemo(() => {
    const map = {};
    departments.forEach((d) => (map[d.id] = d.name));
    return map;
  }, [departments]);

  // Optimistic profile patch with rollback on error.
  async function patchProfile(person, patch, successMsg) {
    setSavingId(person.id);
    const prev = { ...person };
    setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, ...patch } : p)));
    const { error } = await supabase.from('profiles').update(patch).eq('id', person.id);
    setSavingId(null);
    if (error) {
      setPeople((list) => list.map((p) => (p.id === person.id ? prev : p)));
      toast.error(error.message);
      return;
    }
    toast.success(successMsg);
  }

  function changeRole(person, role) {
    if (role === person.role) return;
    patchProfile(person, { role }, 'Role updated');
  }

  function changeDepartment(person, deptId) {
    patchProfile(person, { department_id: deptId || null }, 'Department updated');
  }

  async function removeUser(person) {
    if (!window.confirm(`Remove ${fullName(person)}? They'll lose access (soft delete).`)) return;
    setSavingId(person.id);
    const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', person.id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPeople((list) => list.filter((p) => p.id !== person.id));
    toast.success('User removed');
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.first_name, p.last_name, p.email, p.role].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [people, query]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p>Manage roles, departments, and team assignments</p>
        </div>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card">
        {loading ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <div className="empty-state">No users match your search.</div>
        ) : (
          <div className="table-wrap">
            <table className="table table--striped">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const isSelf = p.id === user.id;
                  const isOwner = p.role === 'owner';
                  const roleLocked = isSelf || isOwner; // can't change self or another owner
                  const busy = savingId === p.id;
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>
                          {initials(p)}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{fullName(p)}</span>
                        {isSelf && <span className="badge badge--gray" style={{ marginLeft: 8 }}>You</span>}
                      </td>
                      <td className="dim">{p.email}</td>
                      <td>
                        <select
                          className="select"
                          style={{ maxWidth: 130, fontWeight: 600, ...(ROLE_STYLE[p.role] || {}) }}
                          value={p.role || 'user'}
                          disabled={roleLocked || busy}
                          title={
                            isSelf
                              ? "You can't change your own role"
                              : isOwner
                              ? "Another owner's role can't be changed here"
                              : 'Change role'
                          }
                          onChange={(e) => changeRole(p, e.target.value)}
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {departments.length === 0 ? (
                          <span className="dim" title="Run the departments migration to enable">
                            {deptName[p.department_id] || '—'}
                          </span>
                        ) : (
                          <select
                            className="select"
                            style={{ maxWidth: 160 }}
                            value={p.department_id || ''}
                            disabled={busy}
                            onChange={(e) => changeDepartment(p, e.target.value)}
                          >
                            <option value="">—</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn--danger btn--sm"
                          disabled={isSelf || isOwner || busy}
                          title={isSelf || isOwner ? 'Owners cannot be removed here' : 'Soft-delete this user'}
                          onClick={() => removeUser(p)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
