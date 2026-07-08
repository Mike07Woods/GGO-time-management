// src/pages/AuditLog.js
// Phase 3 — Audit Log (owner only; the /audit route is owner-gated in App.js and
// RLS restricts the table to owners). Entries are written automatically by
// database triggers, so this page only reads, filters and exports them.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { SkeletonList } from '../components/Skeleton';

function compactJson(value) {
  if (value == null) return '—';
  try {
    const s = JSON.stringify(value);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  } catch {
    return String(value);
  }
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
    });
    return map;
  }, [people]);

  const load = useCallback(async () => {
    setLoading(true);
    const [logRes, pRes] = await Promise.all([
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('profiles').select('id, first_name, last_name, email'),
    ]);
    if (logRes.error) setError(logRes.error.message);
    setLogs(logRes.data || []);
    setPeople(pRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const actionTypes = useMemo(() => {
    const set = new Set(logs.map((l) => l.action).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null;

    return logs.filter((l) => {
      if (userFilter !== 'all' && l.user_id !== userFilter) return false;
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      const t = new Date(l.created_at).getTime();
      if (fromTime && t < fromTime) return false;
      if (toTime && t > toTime) return false;
      if (q) {
        const hay = [
          nameById[l.user_id],
          l.action,
          l.resource_type,
          l.resource_id,
          compactJson(l.old_value),
          compactJson(l.new_value),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, userFilter, actionFilter, from, to, search, nameById]);

  function exportCsv() {
    const header = ['Timestamp', 'User', 'Action', 'Resource type', 'Resource id', 'Old value', 'New value'];
    const body = filtered.map((l) => [
      new Date(l.created_at).toLocaleString(),
      nameById[l.user_id] || l.user_id || 'System',
      l.action,
      l.resource_type,
      l.resource_id,
      compactJson(l.old_value),
      compactJson(l.new_value),
    ]);
    downloadCsv('audit_log.csv', [header, ...body]);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1><ScrollText size={20} /> Audit Log</h1>
          <p>{filtered.length} of {logs.length} entries</p>
        </div>
        <button className="btn btn--ghost" onClick={exportCsv} disabled={filtered.length === 0}>
          ⬇ Export CSV
        </button>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>User</label>
            <select className="select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="all">All users</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameById[p.id]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>Action</label>
            <select className="select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              {actionTypes.map((a) => (
                <option key={a} value={a}>
                  {a === 'all' ? 'All actions' : a}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label>Search</label>
            <input
              className="input"
              placeholder="Search any field…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <div className="empty-state">No matching audit entries.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Old value</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id}>
                    <td className="dim" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td>{nameById[l.user_id] || (l.user_id ? l.user_id.slice(0, 8) : 'System')}</td>
                    <td>
                      <span className="badge badge--purple">{l.action}</span>
                    </td>
                    <td className="dim">
                      {l.resource_type}
                      {l.resource_id ? ` · ${String(l.resource_id).slice(0, 8)}` : ''}
                    </td>
                    <td className="dim" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {compactJson(l.old_value)}
                    </td>
                    <td className="dim" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {compactJson(l.new_value)}
                    </td>
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
