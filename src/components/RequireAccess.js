// src/components/RequireAccess.js
// Route-level guard. Redirects to the dashboard if the current role can't access
// the given page. Shares the single source of truth in src/lib/permissions.js
// (no duplicated rules).

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useRole } from '../hooks/useRole';
import { canAccessPage } from '../lib/permissions';

export default function RequireAccess({ pageKey, children }) {
  const { role } = useRole();
  if (!canAccessPage(role, pageKey)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
