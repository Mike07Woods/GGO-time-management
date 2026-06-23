// src/pages/Directory.js
// Employee directory built from the profiles table.
// Everyone can browse + search (read-only). User management — changing roles and
// activating/deactivating people — is admin/owner only, and an admin may NOT
// modify other admins or owners (only an owner can).

import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}

export default function Directory() {
  // Capability helpers drive every management control on this page.
  const { canManageUsers, canManageUser, assignableRoles } = useRole();

  const manageUsers = canManageUsers(); // admin + owner
  const roleOptions = assignableRoles(); // roles THIS actor may assign

  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  async function loadPeople() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('first_name', { ascending: true });
    if (error) setError(error.message);
    setPeople(data || []);
    setLoading(false);
  }

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
      setError(error.message);
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === person.id ? { ...p, role } : p)));
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
      setError(error.message);
      return;
    }
    setPeople((prev) =>
      prev.map((p) => (p.id === person.id ? { ...p, is_active: !person.is_active } : p))
    );
  }

  // Client-side search filter.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.first_name, p.last_name, p.email, p.department, p.position]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [people, query]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Employee Directory</h1>
          <p>{people.length} team members</p>
        </div>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search name, email, department…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading directory…</p>
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
                          <div className="avatar">
                            {p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p)}
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

                      <td>{p.department || '—'}</td>
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
