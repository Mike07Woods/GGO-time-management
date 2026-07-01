// src/hooks/useRole.js
// Thin React wrapper over the pure RBAC logic in src/lib/permissions.js.
// Binds every capability check to the signed-in user's role so pages can call
// e.g. canCreate('announcement') without passing the role around.

import { useAuth } from './useAuth';
import * as perms from '../lib/permissions';

// Re-exported for consumers that import it from here (e.g. ProtectedRoute).
export const ROLE_LEVELS = perms.ROLE_LEVELS;

export function useRole() {
  const { role } = useAuth();

  return {
    role,
    level: perms.roleLevel(role),

    hasRole: (target) => role === target,
    isAtLeast: (target) => perms.isAtLeast(role, target),

    isManager: perms.isManager(role),
    isAdmin: perms.isAdmin(role),
    isOwner: perms.isOwner(role),

    canCreate: (resource) => perms.canCreate(role, resource),
    canEdit: (resource) => perms.canEdit(role, resource),
    canDelete: () => perms.canDelete(role),
    canManageUsers: () => perms.canManageUsers(role),
    canManageUser: (targetRole) => perms.canManageUser(role, targetRole),
    assignableRoles: () => perms.assignableRoles(role),
  };
}

export default useRole;
