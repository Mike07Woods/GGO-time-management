// src/pages/Overtime.js
// Phase 2 — Overtime tracking (manager+ page; rule editing is owner/admin only).
// Calculates each employee's weekly hours from time_entries, compares to the
// active overtime rule, colour-codes the result, and exports to CSV.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

function startOfWeek(d) {
  const date = new Date(d);
  const dow = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - dow);
  return date;
}

function prettyDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Trigger a browser download of a CSV string.
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

export default function Overtime() {
  const { profile } = useAuth();
  const { isAdmin } = useRole();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [rule, setRule] = useState(null);
  const [ruleForm, setRuleForm] = useState(null);
  const [rows, setRows] = useState([]); // [{ id, name, hours }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  const weekEnd = useMemo(() => {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 6);
    return e;
  }, [weekStart]);

  const weeklyThreshold = Number(rule?.weekly_threshold ?? 40);

  // Load the active overtime rule once.
  useEffect(() => {
    async function loadRule() {
      const { data } = await supabase
        .from('overtime_rules')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      setRule(data || null);
      setRuleForm(data || null);
    }
    loadRule();
  }, []);

  // Recompute per-employee hours for the selected week.
  const loadWeek = useCallback(async () => {
    setLoading(true);
    setError('');

    const startIso = weekStart.toISOString();
    const endExclusive = new Date(weekStart);
    endExclusive.setDate(endExclusive.getDate() + 7);

    // People in scope: managers see their department, admins/owners see all.
    let peopleQuery = supabase
      .from('profiles')
      .select('id, first_name, last_name, email, department')
      .eq('is_active', true);
    if (!isAdmin) {
      peopleQuery = peopleQuery.eq('department', profile?.department || '___none___');
    }

    const [peopleRes, entriesRes] = await Promise.all([
      peopleQuery,
      supabase
        .from('time_entries')
        .select('user_id, total_hours, status')
        .gte('clock_in', startIso)
        .lt('clock_in', endExclusive.toISOString()),
    ]);

    if (entriesRes.error) setError(entriesRes.error.message);

    const hoursByUser = {};
    (entriesRes.data || []).forEach((e) => {
      if (e.status !== 'completed' || e.total_hours == null) return;
      hoursByUser[e.user_id] = (hoursByUser[e.user_id] || 0) + Number(e.total_hours);
    });

    const people = peopleRes.data || [];
    const computed = people
      .map((p) => ({
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
        hours: hoursByUser[p.id] || 0,
      }))
      .sort((a, b) => b.hours - a.hours);

    setRows(computed);
    setLoading(false);
  }, [weekStart, isAdmin, profile]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  function shiftWeek(delta) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(startOfWeek(d));
  }

  // Status + colour for a given hours figure vs the threshold.
  function classify(hours) {
    if (hours > weeklyThreshold) return { label: 'Overtime', badge: 'badge--red' };
    if (hours >= weeklyThreshold * 0.9) return { label: 'Approaching', badge: 'badge--amber' };
    return { label: 'Normal', badge: 'badge--green' };
  }

  async function saveRule(e) {
    e.preventDefault();
    if (!ruleForm) return;
    setSavingRule(true);
    setError('');

    const payload = {
      name: ruleForm.name || 'Standard',
      daily_threshold: Number(ruleForm.daily_threshold) || 8,
      weekly_threshold: Number(ruleForm.weekly_threshold) || 40,
      multiplier: Number(ruleForm.multiplier) || 1.5,
      is_active: true,
    };

    // Update the existing rule, or create one if none exists yet.
    const resp = rule?.id
      ? await supabase.from('overtime_rules').update(payload).eq('id', rule.id).select().single()
      : await supabase.from('overtime_rules').insert(payload).select().single();

    setSavingRule(false);
    if (resp.error) {
      setError(resp.error.message);
      return;
    }
    setRule(resp.data);
    setRuleForm(resp.data);
    loadWeek();
  }

  function exportCsv() {
    const header = ['Employee', 'Hours', 'Threshold', 'Overtime', 'Status'];
    const body = rows.map((r) => [
      r.name,
      r.hours.toFixed(2),
      weeklyThreshold,
      Math.max(0, r.hours - weeklyThreshold).toFixed(2),
      classify(r.hours).label,
    ]);
    downloadCsv(`overtime_${prettyDate(weekStart).replace(/\s/g, '')}.csv`, [header, ...body]);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Overtime Tracking</h1>
          <p>Weekly hours vs. your overtime threshold.</p>
        </div>
        <button className="btn btn--ghost" onClick={exportCsv} disabled={rows.length === 0}>
          ⬇ Export CSV
        </button>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Overtime rule */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card__title">Overtime Rule</div>
        {isAdmin ? (
          <form onSubmit={saveRule}>
            <div className="form-row">
              <div className="field">
                <label>Rule name</label>
                <input
                  className="input"
                  value={ruleForm?.name || ''}
                  onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                  placeholder="Standard"
                />
              </div>
              <div className="field">
                <label>Daily threshold (h)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input"
                  value={ruleForm?.daily_threshold ?? 8}
                  onChange={(e) => setRuleForm({ ...ruleForm, daily_threshold: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Weekly threshold (h)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input"
                  value={ruleForm?.weekly_threshold ?? 40}
                  onChange={(e) => setRuleForm({ ...ruleForm, weekly_threshold: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Pay multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={ruleForm?.multiplier ?? 1.5}
                  onChange={(e) => setRuleForm({ ...ruleForm, multiplier: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn--primary" disabled={savingRule}>
              {savingRule ? 'Saving…' : 'Save rule'}
            </button>
          </form>
        ) : (
          <div className="row" style={{ gap: 28, flexWrap: 'wrap' }}>
            <div>
              <div className="stat__label">Daily threshold</div>
              <div style={{ fontWeight: 700 }}>{rule?.daily_threshold ?? 8}h</div>
            </div>
            <div>
              <div className="stat__label">Weekly threshold</div>
              <div style={{ fontWeight: 700 }}>{weeklyThreshold}h</div>
            </div>
            <div>
              <div className="stat__label">Multiplier</div>
              <div style={{ fontWeight: 700 }}>×{rule?.multiplier ?? 1.5}</div>
            </div>
          </div>
        )}
      </div>

      {/* Per-employee overtime */}
      <div className="card">
        <div className="card__title">
          <span>
            Week of {prettyDate(weekStart)} – {prettyDate(weekEnd)}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(-1)}>
              ← Prev
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(1)}>
              Next →
            </button>
          </span>
        </div>

        {loading ? (
          <p className="muted">Calculating…</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">No employees in scope for this week.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Hours</th>
                  <th>Overtime</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = classify(r.hours);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.hours.toFixed(2)}h</td>
                      <td>{Math.max(0, r.hours - weeklyThreshold).toFixed(2)}h</td>
                      <td>
                        <span className={'badge ' + c.badge}>{c.label}</span>
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
