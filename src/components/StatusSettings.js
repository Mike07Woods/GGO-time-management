// src/components/StatusSettings.js
// Owner/admin-only status configuration, embedded in the Settings page. Controls
// the AFK timeout, ping cooldown, custom-note toggle, and the set of custom
// (non-system) statuses. Self-gates on role and renders nothing for others.

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { usePresence } from '../context/PresenceContext';
import { supabase } from '../supabaseClient';

export default function StatusSettings() {
  const { isAdmin } = useRole();
  const toast = useToast();
  const { enabled, statusTypes, settings, reloadStatusTypes, refreshSettings } = usePresence();

  const [afk, setAfk] = useState(15);
  const [cooldown, setCooldown] = useState(5);
  const [allowNotes, setAllowNotes] = useState(true);
  const [customs, setCustoms] = useState([]); // editable non-system statuses
  const [deleted, setDeleted] = useState([]); // ids removed from the list
  const [limits, setLimits] = useState({}); // status id -> max_minutes (string)
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingStatuses, setSavingStatuses] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);

  useEffect(() => {
    setAfk(settings.afk_timeout_minutes ?? 15);
    setCooldown(settings.ping_cooldown_minutes ?? 5);
    setAllowNotes(settings.allow_custom_notes ?? true);
  }, [settings]);

  useEffect(() => {
    const m = {};
    statusTypes.forEach((s) => (m[s.id] = s.max_minutes == null ? '' : String(s.max_minutes)));
    setLimits(m);
  }, [statusTypes]);

  useEffect(() => {
    setCustoms(
      statusTypes
        .filter((s) => !s.is_system)
        .map((s) => ({ id: s.id, name: s.name, emoji: s.emoji || '', color: s.color || '#6B7280' }))
    );
  }, [statusTypes]);

  // Admins/owners only.
  if (!isAdmin) return null;

  if (!enabled) {
    return (
      <div className="card">
        <div className="card__title">Status Settings</div>
        <div className="dim">
          Run <code>supabase-team-status.sql</code> in the Supabase SQL Editor to enable live team
          status.
        </div>
      </div>
    );
  }

  const updateRow = (i, patch) => setCustoms((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setCustoms((p) => [...p, { name: '', emoji: '', color: '#3B82F6', isNew: true }]);
  const removeRow = (i) =>
    setCustoms((p) => {
      const row = p[i];
      if (row.id) setDeleted((d) => [...d, row.id]);
      return p.filter((_, idx) => idx !== i);
    });

  async function saveSettings() {
    setSavingSettings(true);
    const { error } = await supabase
      .from('status_settings')
      .update({
        afk_timeout_minutes: Number(afk),
        ping_cooldown_minutes: Number(cooldown),
        allow_custom_notes: allowNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id);
    setSavingSettings(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshSettings();
    toast.success('Status settings saved');
  }

  async function saveStatuses() {
    for (const r of customs) {
      if (!r.name.trim()) {
        toast.error('Every status needs a name.');
        return;
      }
    }
    setSavingStatuses(true);
    if (deleted.length) await supabase.from('status_types').delete().in('id', deleted);
    for (const r of customs) {
      const payload = { name: r.name.trim(), emoji: r.emoji || null, color: r.color };
      if (r.id) {
        await supabase.from('status_types').update(payload).eq('id', r.id);
      } else {
        await supabase.from('status_types').insert({ ...payload, is_system: false, sort_order: 50 });
      }
    }
    setDeleted([]);
    setSavingStatuses(false);
    await reloadStatusTypes();
    toast.success('Custom statuses saved');
  }

  async function saveLimits() {
    setSavingLimits(true);
    for (const s of statusTypes) {
      const raw = limits[s.id];
      const next = raw === '' || raw == null ? null : Number(raw);
      if (next !== (s.max_minutes ?? null)) {
        await supabase.from('status_types').update({ max_minutes: next }).eq('id', s.id);
      }
    }
    setSavingLimits(false);
    await reloadStatusTypes();
    toast.success('Time limits saved');
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card__title">Status Settings</div>

      <div className="form-row">
        <div className="field">
          <label>Mark user as AFK after (minutes)</label>
          <input
            type="number"
            className="input"
            min={1}
            max={120}
            value={afk}
            onChange={(e) => setAfk(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Minimum time between pings (minutes)</label>
          <input
            type="number"
            className="input"
            min={1}
            max={60}
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={allowNotes} onChange={(e) => setAllowNotes(e.target.checked)} />
          Allow users to set a custom status note
        </label>
      </div>

      <button className="btn btn--primary btn--sm" onClick={saveSettings} disabled={savingSettings}>
        {savingSettings ? 'Saving…' : 'Save settings'}
      </button>

      {/* Per-disposition time limits */}
      <div className="card__title" style={{ marginTop: 24 }}>
        Time limits
      </div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
        Flag a user on the monitor (and notify them) if they stay in a status past this many minutes.
        Leave blank for no limit.
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {statusTypes.map((s) => (
          <div key={s.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span style={{ width: 130, fontSize: 14 }}>
              {s.emoji} {s.name}
            </span>
            <input
              type="number"
              className="input"
              min={1}
              max={480}
              style={{ maxWidth: 120 }}
              placeholder="No limit"
              value={limits[s.id] ?? ''}
              onChange={(e) => setLimits((m) => ({ ...m, [s.id]: e.target.value }))}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              minutes
            </span>
          </div>
        ))}
      </div>
      <button
        className="btn btn--primary btn--sm"
        style={{ marginTop: 12 }}
        onClick={saveLimits}
        disabled={savingLimits}
      >
        {savingLimits ? 'Saving…' : 'Save time limits'}
      </button>

      {/* Custom statuses */}
      <div className="card__title" style={{ marginTop: 24 }}>
        Custom statuses
      </div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
        The four system statuses (Active, On Break, AFK, Offline) can’t be edited here.
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {customs.length === 0 && <div className="dim">No custom statuses yet.</div>}
        {customs.map((r, i) => (
          <div key={r.id || `new-${i}`} className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={r.color}
              onChange={(e) => updateRow(i, { color: e.target.value })}
              title="Color"
              style={{ width: 38, height: 34, padding: 2, border: '1px solid var(--border-color)', borderRadius: 6, background: 'transparent' }}
            />
            <input
              className="input"
              style={{ width: 60, textAlign: 'center' }}
              maxLength={2}
              placeholder="🙂"
              value={r.emoji}
              onChange={(e) => updateRow(i, { emoji: e.target.value })}
              title="Emoji"
            />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Status name"
              value={r.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
            />
            <button
              className="btn btn--danger btn--sm"
              onClick={() => removeRow(i)}
              title="Delete status"
              aria-label="Delete status"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn btn--ghost btn--sm" onClick={addRow}>
          <Plus size={15} /> Add status
        </button>
        <button className="btn btn--primary btn--sm" onClick={saveStatuses} disabled={savingStatuses}>
          {savingStatuses ? 'Saving…' : 'Save statuses'}
        </button>
      </div>
    </div>
  );
}
