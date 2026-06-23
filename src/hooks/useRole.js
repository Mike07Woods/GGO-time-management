// src/hooks/useRole.js
// Centralizes ALL role logic so pages never hardcode role strings.
// Hierarchy (low -> high): user < manager < admin < owner.
//
// Permission matrix this encodes:
//   OWNER   — full access, no restrictions
//   ADMIN   — like owner, but cannot change other admin/owner roles
//   MANAGER — can create/manage shifts (for their team); read-only announcements;
//             cannot delete; no user management
//   USER    — read-only everywhere; only their own data

import { useAuth } from './useAuth';

// Numeric levels make "at least" comparisons easy.
export const ROLE_LEVELS = {
  user: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

// Roles an admin is NOT allowed to modify (only an owner can touch these).
const PROTECTED_ROLES = ['admin', 'owner'];

export function useRole() {
  const { role } = useAuth();
  const level = ROLE_LEVELS[role] ?? 0;

  // Common convenience flags.
  const isManager = level >= ROLE_LEVELS.manager; // manager, admin or owner
  const isAdmin = level >= ROLE_LEVELS.admin; // admin or owner
  const isOwner = role === 'owner';

  // --- Capability helpers ----------------------------------------------------
  // These accept an optional `resource` so a single call site reads naturally,
  // e.g. canCreate('announcement'). Defaults cover the most common case.

  // Who can CREATE a given resource?
  //   shift        -> manager and above
  //   announcement -> admin and above (managers are read-only)
  //   form         -> admin and above
  function canCreate(resource = 'shift') {
    switch (resource) {
      case 'announcement':
      case 'form':
        return isAdmin;
      case 'shift':
      default:
        return isManager;
    }
  }

  // Who can EDIT a given resource?
  //   shift            -> manager and above
  //   user/profile     -> admin and above (further narrowed by canManageUser)
  //   announcement     -> admin and above
  function canEdit(resource = 'shift') {
    switch (resource) {
      case 'user':
      case 'profile':
      case 'announcement':
        return isAdmin;
      case 'shift':
      default:
        return isManager;
    }
  }

  // Who can DELETE anything? Only admins/owners. Managers and users cannot.
  function canDelete() {
    return isAdmin;
  }

  // Who can access the user-management area (role + active-status changes)?
  function canManageUsers() {
    return isAdmin;
  }

  // Can the current actor manage (change role / status of) a user whose CURRENT
  // role is `targetRole`?
  //   owner -> anyone
  //   admin -> everyone EXCEPT other admins/owners
  function canManageUser(targetRole) {
    if (isOwner) return true;
    if (isAdmin) return !PROTECTED_ROLES.includes(targetRole);
    return false;
  }

  // Which roles may the current actor ASSIGN to someone else?
  //   owner -> all four
  //   admin -> user/manager only (cannot grant admin/owner)
  //   below -> none
  function assignableRoles() {
    if (isOwner) return ['user', 'manager', 'admin', 'owner'];
    if (isAdmin) return ['user', 'manager'];
    return [];
  }

  return {
    role,
    level,

    // Exact / threshold checks.
    hasRole: (target) => role === target,
    isAtLeast: (target) => level >= (ROLE_LEVELS[target] ?? 99),

    // Convenience flags.
    isManager,
    isAdmin,
    isOwner,

    // Capability helpers.
    canCreate,
    canEdit,
    canDelete,
    canManageUsers,
    canManageUser,
    assignableRoles,
  };
}

export default useRole;
