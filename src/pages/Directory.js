// src/pages/Directory.js
// Employee directory built from the profiles table.
// Everyone can browse + search. Admins/owners can change a person's role and
// toggle their active status inline.

import React, { useEffect, useMemo, useState } from 'react';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

const ROLES = ['user', 'manager', 'admin', 'owner'];

function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}

export default function Directory() {
  const { isAdmin } = useRole(); // admins + owners can manage roles/status

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

  // Update a person's role (admins/owners only).
  async function changeRole(id, role) {
    setError('');
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, role } : p)));
  }

  // Activate / deactivate a person (admins/owners only).
  async function toggleActive(id, isActive) {
    setError('');
    const { error } = await supabase.from('profiles').update({ is_active: !isActive }).eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: !isActive } : p)));
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
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
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
                      {/* Admins get a dropdown; others see a static badge */}
                      {isAdmin ? (
                        <select
                          className="select"
                          style={{ maxWidth: 130 }}
                          value={p.role || 'user'}
                          onChange={(e) => changeRole(p.id, e.target.value)}
                        >
                          {ROLES.map((r) => (
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

                    {isAdmin && (
                      <td>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => toggleActive(p.id, p.is_active)}
                        >
                          {p.is_active ? 'Deactivate' : 'Activate'}
                        </button>
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
