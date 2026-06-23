// src/components/ProtectedRoute.js
// Route guard:
//   - waits for auth to finish loading,
//   - redirects unauthenticated users to /login,
//   - blocks the whole page when the user's role isn't allowed.
//
// Two ways to gate a route:
//   <ProtectedRoute requiredRole="admin">      -> needs that role OR higher (by level)
//   <ProtectedRoute allowedRoles={['owner']}>  -> must be exactly one of these roles
// If neither prop is given, any authenticated user may enter.

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_LEVELS } from '../hooks/useRole';

export default function ProtectedRoute({ children, requiredRole, allowedRoles }) {
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

  const role = profile?.role;

  // 3) Role gating.
  // An explicit allow-list (if provided) takes precedence over a minimum role.
  let permitted = true;
  if (allowedRoles && allowedRoles.length > 0) {
    permitted = allowedRoles.includes(role);
  } else if (requiredRole) {
    const userLevel = ROLE_LEVELS[role] ?? 0;
    const neededLevel = ROLE_LEVELS[requiredRole] ?? 99;
    permitted = userLevel >= neededLevel;
  }

  if (!permitted) {
    const requirement = allowedRoles?.length
      ? `one of: ${allowedRoles.join(', ')}`
      : `${requiredRole} access or higher`;
    return (
      <div className="access-denied">
        <div>
          <h2>Access denied</h2>
          <p className="muted">
            This area requires <strong>{requirement}</strong>. Your role is{' '}
            <strong>{role || 'unknown'}</strong>.
          </p>
        </div>
      </div>
    );
  }

  // 4) Authorized — render the protected content.
  return children;
}
