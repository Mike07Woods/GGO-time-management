// src/components/NotificationPreferences.js
// "Push Notifications" section for the Settings page. Shows only the preference
// toggles relevant to the user's role and saves each change immediately. Owners
// additionally get an "Org Defaults" editor (applied to new users' first row).

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';

// Toggle metadata grouped by the minimum role level that sees it.
const GROUPS = [
  {
    label: 'Everyone',
    minLevel: 1,
    items: [
      { key: 'pings', title: 'Pings', desc: 'When a manager pings you' },
      { key: 'chat_messages', title: 'Chat messages', desc: 'New messages in your channels' },
      { key: 'shift_reminders', title: 'Shift reminders', desc: 'Before an upcoming shift' },
      { key: 'announcements', title: 'Announcements', desc: 'New company announcements' },
    ],
  },
  {
    label: 'Manager',
    minLevel: 2,
    items: [
      { key: 'employee_clock_events', title: 'Employee clock in/out', desc: "When your team clocks in or out" },
      { key: 'afk_alerts', title: 'AFK & disposition alerts', desc: 'When someone exceeds a disposition limit' },
      { key: 'timesheet_approvals', title: 'Timesheet approvals', desc: 'Timesheets awaiting your review' },
      { key: 'help_desk_tickets', title: 'Help desk tickets', desc: 'New or updated tickets' },
    ],
  },
  {
    label: 'Admin',
    minLevel: 3,
    items: [
      { key: 'all_department_alerts', title: 'All department alerts', desc: 'Alerts across every department' },
      { key: 'new_signups', title: 'New user signups', desc: 'When a new account is created' },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.items.map((i) => i.key));

// A simple switch-style checkbox.
function Toggle({ checked, onChange, disabled }) {
  return (
    <label className="np-switch">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange} />
      <span className="np-slider" />
    </label>
  );
}

export default function NotificationPreferences() {
  const { user } = useAuth();
  const { level, isOwner } = useRole();
  const toast = useToast();

  const [prefs, setPrefs] = useState(null);
  const [enabled, setEnabled] = useState(true); // false if the tables are missing
  const [orgDefaults, setOrgDefaults] = useState({ manager: null, user: null });
  const [savingOrg, setSavingOrg] = useState(false);

  // Load (or create from org defaults) this user's preference row.
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      setEnabled(false);
      return;
    }
    if (data) {
      setPrefs(data);
      return;
    }
    // No row yet — seed from the org defaults for this role.
    const defaultRole = level >= 2 ? 'manager' : 'user';
    const { data: def } = await supabase
      .from('org_notification_defaults')
      .select('*')
      .eq('role', defaultRole)
      .maybeSingle();
    const base = {};
    ALL_KEYS.forEach((k) => (base[k] = def ? def[k] !== false : true));
    const { data: created } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, ...base }, { onConflict: 'user_id' })
      .select()
      .single();
    setPrefs(created || { user_id: user.id, ...base });
  }, [user.id, level]);

  useEffect(() => {
    load();
  }, [load]);

  // Owners: load the per-role org defaults.
  useEffect(() => {
    if (!isOwner) return;
    (async () => {
      const { data } = await supabase.from('org_notification_defaults').select('*');
      const map = { manager: null, user: null };
      (data || []).forEach((r) => (map[r.role] = r));
      setOrgDefaults(map);
    })();
  }, [isOwner]);

  async function toggle(key) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, [key]: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) toast.error(error.message);
    else toast.success('Preferences saved');
  }

  function toggleOrg(role, key) {
    setOrgDefaults((m) => ({ ...m, [role]: { ...(m[role] || { role }), [key]: !(m[role]?.[key] !== false) } }));
  }

  async function saveOrgDefaults() {
    setSavingOrg(true);
    const rows = ['manager', 'user'].map((role) => {
      const src = orgDefaults[role] || { role };
      const row = { role, updated_at: new Date().toISOString() };
      ALL_KEYS.forEach((k) => (row[k] = src[k] !== false));
      return row;
    });
    const { error } = await supabase.from('org_notification_defaults').upsert(rows, { onConflict: 'role' });
    setSavingOrg(false);
    if (error) toast.error(error.message);
    else toast.success('Org defaults saved');
  }

  const visibleGroups = GROUPS.filter((g) => level >= g.minLevel);

  if (!enabled) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card__title">Push Notifications</div>
        <div className="dim">
          Run <code>supabase-push.sql</code> in the Supabase SQL Editor to enable notification
          preferences.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <style>{`
        .np-row { display:flex; align-items:center; gap:14px; padding:10px 0; border-bottom:1px solid var(--border); }
        .np-row:last-child { border-bottom:none; }
        .np-row__meta { flex:1; min-width:0; }
        .np-row__title { font-weight:600; font-size:14px; }
        .np-row__desc { font-size:12px; color:var(--text-secondary); }
        .np-group-label { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted); margin:16px 0 2px; }
        .np-switch { position:relative; display:inline-block; width:40px; height:22px; flex-shrink:0; }
        .np-switch input { opacity:0; width:0; height:0; }
        .np-slider { position:absolute; cursor:pointer; inset:0; background:var(--surface-2); border:1px solid var(--border); border-radius:999px; transition:.2s; }
        .np-slider:before { content:""; position:absolute; height:16px; width:16px; left:2px; top:2px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 2px rgba(0,0,0,.3); }
        .np-switch input:checked + .np-slider { background:var(--accent); border-color:var(--accent); }
        .np-switch input:checked + .np-slider:before { transform:translateX(18px); }
      `}</style>

      <div className="card__title">Push Notifications</div>

      {!prefs ? (
        <div className="dim">Loading…</div>
      ) : (
        visibleGroups.map((g) => (
          <div key={g.label}>
            {g.minLevel > 1 && <div className="np-group-label">{g.label} &amp; above</div>}
            {g.items.map((it) => (
              <div key={it.key} className="np-row">
                <div className="np-row__meta">
                  <div className="np-row__title">{it.title}</div>
                  <div className="np-row__desc">{it.desc}</div>
                </div>
                <Toggle checked={prefs[it.key]} onChange={() => toggle(it.key)} />
              </div>
            ))}
          </div>
        ))
      )}

      {/* Owner: org-wide defaults for new users */}
      {isOwner && (
        <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="card__title" style={{ marginBottom: 4 }}>
            Org Defaults
          </div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
            Applied when a new user’s preferences are first created. Employees use the “Employee”
            column; managers/admins use the “Manager” column.
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Notification</th>
                  <th>Employee</th>
                  <th>Manager</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.flatMap((g) => g.items).map((it) => (
                  <tr key={it.key}>
                    <td>{it.title}</td>
                    <td>
                      <Toggle
                        checked={orgDefaults.user?.[it.key] !== false}
                        onChange={() => toggleOrg('user', it.key)}
                      />
                    </td>
                    <td>
                      <Toggle
                        checked={orgDefaults.manager?.[it.key] !== false}
                        onChange={() => toggleOrg('manager', it.key)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="btn btn--primary btn--sm"
            style={{ marginTop: 12 }}
            onClick={saveOrgDefaults}
            disabled={savingOrg}
          >
            {savingOrg ? 'Saving…' : 'Save org defaults'}
          </button>
        </div>
      )}
    </div>
  );
}
