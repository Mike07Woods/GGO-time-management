// src/components/ErrorBoundary.js
// Top-level safety net. If any render throws, show a friendly branded screen
// with a reload option instead of a blank white page.

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // A real deployment would forward this to an error tracker (e.g. Sentry).
    // eslint-disable-next-line no-console
    console.error('[GGO] Unhandled UI error:', error, info);
  }

  handleReload = () => {
    // Full reload back to the app root — clears the broken render tree.
    window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0F1E',
          color: '#fff',
          padding: 24,
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#A0AEC0', marginBottom: 22, fontSize: 14 }}>
            An unexpected error occurred. Reloading usually fixes it. If it keeps happening, let your
            administrator know.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: '#004BC8',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '11px 22px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
