// src/components/RequireAccess.js
// Route-level guard. Redirects to the dashboard if the current role can't access
// the given page. Shares the single source of truth in src/lib/permissions.js
// (no duplicated rules).

import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { canAccessPage } from '../lib/permissions';

export default function RequireAccess({ pageKey, children }) {
  const { role } = useRole();
  const toast = useToast();
  const allowed = canAccessPage(role, pageKey);

  useEffect(() => {
    if (!allowed) toast.info('This section is not available for your role.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, pageKey]);

  if (!allowed) return <Navigate to="/" replace />;
  return children;
}
