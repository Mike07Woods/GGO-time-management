// src/pages/Login.js
// Authentication screen — split brand panel (left) + form (right).
// Three modes: sign in, forgot password, sign up. Auth logic is unchanged from
// the original; only the layout/branding was updated.

import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import fullLogoWhite from '../assets/ggo-full-white.png';

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

  const redirectTo = location.state?.from?.pathname || '/';

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

  const titles = {
    [MODES.SIGN_IN]: 'Sign in to your workspace',
    [MODES.FORGOT]: 'Reset your password',
    [MODES.SIGN_UP]: 'Create your account',
  };
  const subtitles = {
    [MODES.SIGN_IN]: 'Welcome to GGO Time Management.',
    [MODES.FORGOT]: "Enter your email and we'll send a reset link.",
    [MODES.SIGN_UP]: 'Set up your account to get started.',
  };
  const submitLabels = {
    [MODES.SIGN_IN]: 'Sign in',
    [MODES.FORGOT]: 'Send reset link',
    [MODES.SIGN_UP]: 'Create account',
  };

  return (
    <div className="auth-layout">
      {/* Left: GGO brand panel */}
      <div className="auth-brand-panel">
        <img
          src={fullLogoWhite}
          alt="Gulf Global Outsourcing"
          style={{ height: '48px', objectFit: 'contain', marginBottom: '8px', display: 'block', position: 'relative', zIndex: 1 }}
        />
        <div className="auth-brand-tag">Time Management</div>
      </div>

      {/* Right: login form */}
      <div className="auth-form-panel">
        <div className="auth-card">
          <h2 className="auth-title" style={{ marginBottom: 4 }}>
            {titles[mode]}
          </h2>
          <p className="auth-sub">{subtitles[mode]}</p>

          {error && <div className="alert alert--error">{error}</div>}
          {info && <div className="alert alert--success">{info}</div>}

          <form onSubmit={handleSubmit}>
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
    </div>
  );
}
