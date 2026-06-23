// src/components/ProtectedRoute.js
// Route guard:
//   - waits for auth to finish loading,
//   - redirects unauthenticated users to /login,
//   - optionally blocks access when the user's role is below `requiredRole`.

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_LEVELS } from '../hooks/useRole';

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  // 1) Still checking the session — show a spinner instead of flashing the login page.
  if (loading) {
    return (
      <div className="loading-screen">
        <div>
          <div className="spinner" />
          Loading your workspace…
        </div>
      </div>
    );
  }

  // 2) Not logged in — send to login and remember where they were going.
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 3) Role gating (only when a requiredRole is provided).
  if (requiredRole) {
    const userLevel = ROLE_LEVELS[profile?.role] ?? 0;
    const neededLevel = ROLE_LEVELS[requiredRole] ?? 99;

    if (userLevel < neededLevel) {
      return (
        <div className="access-denied">
          <div>
            <h2>Access denied</h2>
            <p className="muted">
              This area requires <strong>{requiredRole}</strong> access. Your role is{' '}
              <strong>{profile?.role || 'unknown'}</strong>.
            </p>
          </div>
        </div>
      );
    }
  }

  // 4) Authorized — render the protected content.
  return children;
}
