// src/pages/Directory.js
// Employee directory built from the profiles table.
// Everyone can browse + search (read-only). User management — changing roles and
// activating/deactivating people — is admin/owner only, and an admin may NOT
// modify other admins or owners (only an owner can).

import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import Skeleton from '../components/Skeleton';
import PresenceDot from '../components/PresenceDot';

function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}

export default function Directory() {
  // Capability helpers drive every management control on this page.
  const { canManageUsers, canManageUser, assignableRoles } = useRole();

  const toast = useToast();

  const manageUsers = canManageUsers(); // admin + owner
  const roleOptions = assignableRoles(); // roles THIS actor may assign

  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [error, setError] = useState('');

  async function loadPeople() {
    setLoading(true);
    const [peopleRes, deptRes] = await Promise.all([
      supabase.from('profiles').select('*').order('first_name', { ascending: true }),
      // departments may not exist until the migration is run — fail quietly.
      supabase.from('departments').select('id, name').order('name', { ascending: true }),
    ]);
    if (peopleRes.error) setError(peopleRes.error.message);
    setPeople(peopleRes.data || []);
    setDepartments(deptRes.error ? [] : deptRes.data || []);
    setLoading(false);
  }

  const deptName = useMemo(() => {
    const map = {};
    departments.forEach((d) => (map[d.id] = d.name));
    return map;
  }, [departments]);

  useEffect(() => {
    loadPeople();
  }, []);

  // Update a person's role. Guarded so a forbidden actor can't change a row even
  // if the UI were bypassed.
  async function changeRole(person, role) {
    setError('');
    if (!canManageUser(person.role)) {
      setError('You are not allowed to change this user’s role.');
      return;
    }
    const { error } = await supabase.from('profiles').update({ role }).eq('id', person.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === person.id ? { ...p, role } : p)));
    toast.success(`Role updated to ${role}`);
  }

  // Activate / deactivate a person (same management rule as role changes).
  async function toggleActive(person) {
    setError('');
    if (!canManageUser(person.role)) {
      setError('You are not allowed to change this user’s status.');
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !person.is_active })
      .eq('id', person.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPeople((prev) =>
      prev.map((p) => (p.id === person.id ? { ...p, is_active: !person.is_active } : p))
    );
    toast.success(person.is_active ? 'User deactivated' : 'User activated');
  }

  // Client-side search + department filter.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (deptFilter === 'unassigned' && p.department_id) return false;
      if (deptFilter !== 'all' && deptFilter !== 'unassigned' && p.department_id !== deptFilter) {
        return false;
      }
      if (!q) return true;
      return [p.first_name, p.last_name, p.email, deptName[p.department_id], p.position]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [people, query, deptFilter, deptName]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Employee Directory</h1>
          <p>{people.length} team members</p>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {departments.length > 0 && (
            <select
              className="select"
              style={{ maxWidth: 200 }}
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="all">All departments</option>
              <option value="unassigned">Unassigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Search name, email, department…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="stack">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="row" style={{ padding: '8px 0', gap: 12 }}>
                <Skeleton width={38} height={38} radius={999} />
                <div style={{ flex: 1 }}>
                  <Skeleton width="30%" height={14} style={{ marginBottom: 8 }} />
                  <Skeleton width="45%" height={11} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No team members match your search.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Position</th>
                  <th>Contact</th>
                  <th>Status</th>
                  {/* Actions column only exists for user managers */}
                  {manageUsers && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  // Can the current actor manage THIS specific person?
                  // (admins can't touch other admins/owners)
                  const editable = manageUsers && canManageUser(p.role);

                  // Always include the person's current role as an option so the
                  // <select> can display it even if it's outside what the actor
                  // may assign to others.
                  const options = Array.from(new Set([p.role || 'user', ...roleOptions]));

                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="row">
                          <div className="avatar" style={{ position: 'relative' }}>
                            {p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p)}
                            <PresenceDot userId={p.id} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}
                            </div>
                            <div className="dim" style={{ fontSize: 12 }}>
                              {p.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        {/* Editable dropdown only when this actor may manage this row;
                            otherwise a read-only badge. */}
                        {editable ? (
                          <select
                            className="select"
                            style={{ maxWidth: 130 }}
                            value={p.role || 'user'}
                            onChange={(e) => changeRole(p, e.target.value)}
                          >
                            {options.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge badge--purple">{p.role || 'user'}</span>
                        )}
                      </td>

                      <td>
                        {deptName[p.department_id] ? (
                          <span className="badge badge--teal">{deptName[p.department_id]}</span>
                        ) : (
                          p.department || '—'
                        )}
                      </td>
                      <td>{p.position || '—'}</td>
                      <td>{p.phone || '—'}</td>

                      <td>
                        {p.is_active ? (
                          <span className="badge badge--green">Active</span>
                        ) : (
                          <span className="badge badge--gray">Inactive</span>
                        )}
                      </td>

                      {manageUsers && (
                        <td>
                          {editable ? (
                            <button
                              className="btn btn--ghost btn--sm"
                              onClick={() => toggleActive(p)}
                            >
                              {p.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          ) : (
                            <span className="dim" style={{ fontSize: 12 }}>
                              —
                            </span>
                          )}
                        </td>
                      )}
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
