// src/components/DepartmentClockBoard.js
// Read-only live board for monitors: who in their department is clocked in /
// on break / clocked out right now. No actions — monitors clock only their own
// time (that stays on the main Time Clock card).

import React, { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useMonitorScope } from '../hooks/useMonitorScope';
import { usePresence } from '../context/PresenceContext';

function initials(p) {
  const s = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase();
  return s || (p.email?.[0]?.toUpperCase() ?? '?');
}
function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '—';
}
function clockTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function DepartmentClockBoard() {
  const { memberIds, deptName } = useMonitorScope();
  const { getStatus } = usePresence();

  const [members, setMembers] = useState([]);
  const [openByUser, setOpenByUser] = useState({}); // user_id -> open time_entry
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!memberIds || memberIds.length === 0) {
      setMembers([]);
      setOpenByUser({});
      setLoading(false);
      return;
    }
    const [pRes, eRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_url')
        .in('id', memberIds)
        .eq('is_active', true)
        .order('first_name', { ascending: true }),
      supabase
        .from('time_entries')
        .select('user_id, clock_in, status')
        .in('user_id', memberIds)
        .neq('status', 'completed'),
    ]);
    setMembers(pRes.data || []);
    const map = {};
    (eRes.data || []).forEach((e) => (map[e.user_id] = e));
    setOpenByUser(map);
    setLoading(false);
  }, [memberIds]);

  // Refresh on mount + every 30s.
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="card">
      <div className="card__title">
        <span>
          <Users size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {deptName || 'Department'} — Live Clock Board
        </span>
        {!loading && <span className="badge badge--gray">{members.length}</span>}
      </div>

      {loading ? (
        <div className="dim">Loading…</div>
      ) : members.length === 0 ? (
        <div className="empty-state">No one in your department yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {members.map((p) => {
                const open = openByUser[p.id];
                const st = getStatus(p.id); // live disposition (colour + name)
                const clockedIn = !!open;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="row">
                        <div className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
                          {p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p)}
                        </div>
                        <span style={{ fontWeight: 600 }}>{fullName(p)}</span>
                      </div>
                    </td>
                    <td>
                      {clockedIn ? (
                        <span style={{ color: st?.color, fontWeight: 600 }}>
                          {st?.emoji} {st?.name || 'Clocked in'}
                        </span>
                      ) : (
                        <span className="badge badge--gray">Clocked out</span>
                      )}
                    </td>
                    <td>{clockedIn ? clockTime(open.clock_in) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
