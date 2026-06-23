// src/hooks/useRole.js
// Centralizes role logic so pages never hardcode role strings.
// Hierarchy (low -> high): user < manager < admin < owner.

import { useAuth } from './useAuth';

// Numeric levels make "at least" comparisons easy.
export const ROLE_LEVELS = {
  user: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export function useRole() {
  const { role } = useAuth();
  const level = ROLE_LEVELS[role] ?? 0;

  return {
    role,
    level,

    // Exact match.
    hasRole: (target) => role === target,

    // True if the current role is the given role OR higher.
    isAtLeast: (target) => level >= (ROLE_LEVELS[target] ?? 99),

    // Common convenience flags used across the UI.
    isManager: level >= ROLE_LEVELS.manager, // manager, admin or owner
    isAdmin: level >= ROLE_LEVELS.admin, // admin or owner
    isOwner: role === 'owner',
  };
}

export default useRole;
