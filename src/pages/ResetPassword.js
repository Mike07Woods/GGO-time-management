// src/pages/ResetPassword.js
// Landing page for the password-recovery email link. Supabase parses the
// recovery token from the URL (detectSessionInUrl) and establishes a temporary
// session; this page lets the user set a new password, then signs them out so
// they log in fresh with it.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import fullLogoWhite from '../assets/ggo-full-white.png';

export default function ResetPassword() {
  const navigate = useNavigate();

  const [ready, setReady] = useState(false); // recovery session detected?
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Detect the recovery session. It may arrive via the PASSWORD_RECOVERY event
  // (token still in the URL) or already be present in getSession().
  useEffect(() => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      setReady(ok);
      setChecking(false);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) finish(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) finish(true);
    });

    // If nothing shows up shortly, treat the link as invalid/expired.
    const timer = setTimeout(() => finish(false), 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setBusy(false);
      setError(updErr.message);
      return;
    }
    // Sign out the temporary recovery session so they log in with the new password.
    await supabase.auth.signOut();
    setBusy(false);
    setDone(true);
    setTimeout(() => navigate('/login', { replace: true }), 1800);
  }

  return (
    <div className="auth-layout">
      <div className="auth-brand-panel">
        <img
          src={fullLogoWhite}
          alt="Gulf Global Outsourcing"
          style={{ height: '48px', objectFit: 'contain', marginBottom: '8px', display: 'block', position: 'relative', zIndex: 1 }}
        />
        <div className="auth-brand-tag">Time Management</div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-card">
          <h2 className="auth-title" style={{ marginBottom: 4 }}>
            Choose a new password
          </h2>
          <p className="auth-sub">Set a new password for your account.</p>

          {error && <div className="alert alert--error">{error}</div>}
          {done && <div className="alert alert--success">Password updated. Redirecting to sign in…</div>}

          {checking ? (
            <p className="dim">Verifying your reset link…</p>
          ) : !ready ? (
            <>
              <div className="alert alert--error">
                This reset link is invalid or has expired. Request a new one from the sign-in page.
              </div>
              <button className="btn btn--ghost btn--block" onClick={() => navigate('/login', { replace: true })}>
                ← Back to sign in
              </button>
            </>
          ) : (
            !done && (
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    className="input"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
                <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
                  {busy ? 'Updating…' : 'Update password'}
                </button>
              </form>
            )
          )}
        </div>
      </div>
    </div>
  );
}
