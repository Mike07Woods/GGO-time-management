// src/pages/Directory.js
// Employee directory — read-only browse + search for everyone with access.
// Role editing and activate/deactivate now live in User Management; this page is
// purely for looking people up. "View profile" opens a right-side drawer.

import React, { useEffect, useMemo, useState } from 'react';
import { Users, ChevronRight, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { usePresence } from '../context/PresenceContext';
import Skeleton from '../components/Skeleton';

// Role -> badge class + display label. ('user' shows as "Employee".)
const ROLE_BADGE = { owner: 'badge--purple', admin: 'badge--blue', manager: 'badge--teal', user: 'badge--gray' };
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Manager', user: 'Employee' };

function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}
function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || '—';
}

export default function Directory() {
  const { getStatus } = usePresence();

  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // person shown in the drawer

  async function loadPeople() {
    setLoading(true);
    const [peopleRes, deptRes] = await Promise.all([
      supabase.from('profiles').select('*').order('first_name', { ascending: true }),
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (deptFilter === 'unassigned' && p.department_id) return false;
      if (deptFilter !== 'all' && deptFilter !== 'unassigned' && p.department_id !== deptFilter) return false;
      if (!q) return true;
      return [p.first_name, p.last_name, p.email, deptName[p.department_id], p.position]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [people, query, deptFilter, deptName]);

  function roleBadge(role) {
    return (
      <span className={'badge ' + (ROLE_BADGE[role] || 'badge--gray')}>{ROLE_LABEL[role] || 'Employee'}</span>
    );
  }

  function statusDot(id) {
    const st = getStatus(id);
    return (
      <span
        title={st?.name || 'Offline'}
        style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: st?.color || '#6B7280' }}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>
          <Users size={20} /> Employee Directory
          {!loading && <span className="badge badge--gray" style={{ marginLeft: 6 }}>{people.length}</span>}
        </h1>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {departments.length > 0 && (
            <select className="select" style={{ maxWidth: 190 }} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
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
            style={{ maxWidth: 260 }}
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
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="row">
                        <div className="avatar" style={{ position: 'relative' }}>
                          {p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{fullName(p)}</div>
                          <div className="dim" style={{ fontSize: 12 }}>
                            {p.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{roleBadge(p.role || 'user')}</td>
                    <td>
                      {deptName[p.department_id] ? (
                        <span className="badge badge--teal">{deptName[p.department_id]}</span>
                      ) : (
                        p.department || '—'
                      )}
                    </td>
                    <td>{p.position || '—'}</td>
                    <td>{statusDot(p.id)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => setSelected(p)}>
                        View profile <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Profile drawer (read-only) */}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div className="card__title" style={{ margin: 0 }}>
                Profile
              </div>
              <button className="btn--icon" onClick={() => setSelected(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div className="avatar avatar--lg" style={{ margin: '0 auto 10px' }}>
                {selected.avatar_url ? <img src={selected.avatar_url} alt="" /> : initials(selected)}
              </div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{fullName(selected)}</div>
              <div className="dim" style={{ fontSize: 13 }}>
                {selected.email}
              </div>
              <div style={{ marginTop: 8 }}>{roleBadge(selected.role || 'user')}</div>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              {[
                ['Department', deptName[selected.department_id] || selected.department || '—'],
                ['Position', selected.position || '—'],
                ['Phone', selected.phone || '—'],
                ['Status', selected.is_active ? 'Active' : 'Inactive'],
                ['Presence', getStatus(selected.id)?.name || 'Offline'],
              ].map(([label, value]) => (
                <div key={label} className="row row--between" style={{ gap: 12 }}>
                  <span className="dim" style={{ fontSize: 13 }}>
                    {label}
                  </span>
                  <span style={{ fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
