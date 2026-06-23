// src/pages/Login.js
// Authentication screen with three modes: sign in, forgot password, sign up.
// Sign up is included so the first account can be created (which then triggers
// the first-login profile bootstrap in AuthContext).

import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// The three UI modes this screen can be in.
const MODES = { SIGN_IN: 'sign_in', FORGOT: 'forgot', SIGN_UP: 'sign_up' };

export default function Login() {
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  // Where to go after a successful login (back to the page they wanted, or dashboard).
  const redirectTo = location.state?.from?.pathname || '/';

  // If already logged in, don't show the login page — go straight in.
  if (!loading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  function resetMessages() {
    setError('');
    setInfo('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();
    setBusy(true);

    try {
      if (mode === MODES.SIGN_IN) {
        const { error } = await signIn(email, password);
        if (error) throw error;
        navigate(redirectTo, { replace: true });
        return;
      }

      if (mode === MODES.SIGN_UP) {
        const { data, error } = await signUp(email, password, {
          first_name: firstName,
          last_name: lastName,
        });
        if (error) throw error;

        // If email confirmation is OFF, Supabase returns an active session and
        // the auth listener will log us in automatically. If it's ON, tell the user.
        if (data?.session) {
          navigate(redirectTo, { replace: true });
        } else {
          setInfo('Account created. Check your email to confirm, then sign in.');
          setMode(MODES.SIGN_IN);
        }
        return;
      }

      if (mode === MODES.FORGOT) {
        const { error } = await resetPassword(email);
        if (error) throw error;
        setInfo('If that email exists, a password reset link is on its way.');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Per-mode text.
  const titles = {
    [MODES.SIGN_IN]: 'Welcome back',
    [MODES.FORGOT]: 'Reset your password',
    [MODES.SIGN_UP]: 'Create your account',
  };
  const subtitles = {
    [MODES.SIGN_IN]: 'Sign in to your GGO Time Management workspace.',
    [MODES.FORGOT]: "Enter your email and we'll send a reset link.",
    [MODES.SIGN_UP]: 'Set up your account to get started.',
  };
  const submitLabels = {
    [MODES.SIGN_IN]: 'Sign in',
    [MODES.FORGOT]: 'Send reset link',
    [MODES.SIGN_UP]: 'Create account',
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="sidebar__logo">GG</div>
          <div>
            <div className="auth-title">GGO Time Management</div>
          </div>
        </div>

        <h2 style={{ marginBottom: 4 }}>{titles[mode]}</h2>
        <p className="auth-sub">{subtitles[mode]}</p>

        {error && <div className="alert alert--error">{error}</div>}
        {info && <div className="alert alert--success">{info}</div>}

        <form onSubmit={handleSubmit}>
          {/* Name fields only when creating an account */}
          {mode === MODES.SIGN_UP && (
            <div className="form-row">
              <div className="field">
                <label htmlFor="firstName">First name</label>
                <input
                  id="firstName"
                  className="input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="field">
                <label htmlFor="lastName">Last name</label>
                <input
                  id="lastName"
                  className="input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </div>

          {/* Password is hidden in forgot-password mode */}
          {mode !== MODES.FORGOT && (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === MODES.SIGN_UP ? 'new-password' : 'current-password'}
                placeholder="••••••••"
              />
            </div>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Please wait…' : submitLabels[mode]}
          </button>
        </form>

        {/* Mode switches */}
        {mode === MODES.SIGN_IN && (
          <>
            <div className="auth-switch">
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  resetMessages();
                  setMode(MODES.FORGOT);
                }}
              >
                Forgot your password?
              </button>
            </div>
            <div className="auth-switch">
              Need an account?{' '}
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  resetMessages();
                  setMode(MODES.SIGN_UP);
                }}
              >
                Sign up
              </button>
            </div>
          </>
        )}

        {mode !== MODES.SIGN_IN && (
          <div className="auth-switch">
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                resetMessages();
                setMode(MODES.SIGN_IN);
              }}
            >
              ← Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
