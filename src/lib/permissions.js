// src/lib/permissions.js
// Pure, framework-free RBAC logic — the single source of truth for "who can do
// what". Kept free of React so it can be unit-tested directly (see
// permissions.test.js) and reused on the client and (conceptually) the server.
//
// Role hierarchy (low -> high): user < manager < admin < owner.

export const ROLE_LEVELS = {
  user: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

// Roles an admin is NOT allowed to modify (only an owner can touch these).
const PROTECTED_ROLES = ['admin', 'owner'];

export function roleLevel(role) {
  return ROLE_LEVELS[role] ?? 0;
}

// True if `role` is at least `target` in the hierarchy.
export function isAtLeast(role, target) {
  return roleLevel(role) >= (ROLE_LEVELS[target] ?? 99);
}

export function isManager(role) {
  return roleLevel(role) >= ROLE_LEVELS.manager;
}

export function isAdmin(role) {
  return roleLevel(role) >= ROLE_LEVELS.admin;
}

export function isOwner(role) {
  return role === 'owner';
}

// Who can CREATE a given resource?
//   shift        -> manager and above
//   announcement -> admin and above (managers are read-only)
//   form         -> admin and above
export function canCreate(role, resource = 'shift') {
  switch (resource) {
    case 'announcement':
    case 'form':
      return isAdmin(role);
    case 'shift':
    default:
      return isManager(role);
  }
}

// Who can EDIT a given resource?
//   shift                  -> manager and above
//   user/profile/announce. -> admin and above
export function canEdit(role, resource = 'shift') {
  switch (resource) {
    case 'user':
    case 'profile':
    case 'announcement':
      return isAdmin(role);
    case 'shift':
    default:
      return isManager(role);
  }
}

// Only admins/owners can delete.
export function canDelete(role) {
  return isAdmin(role);
}

// Access to the user-management area.
export function canManageUsers(role) {
  return isAdmin(role);
}

// Can `actorRole` manage (change role/status of) a user whose CURRENT role is
// `targetRole`? Owner: anyone. Admin: everyone except other admins/owners.
export function canManageUser(actorRole, targetRole) {
  if (isOwner(actorRole)) return true;
  if (isAdmin(actorRole)) return !PROTECTED_ROLES.includes(targetRole);
  return false;
}

// Which roles may `actorRole` assign to someone else?
export function assignableRoles(role) {
  if (isOwner(role)) return ['user', 'manager', 'admin', 'owner'];
  if (isAdmin(role)) return ['user', 'manager'];
  return [];
}

// ---------------------------------------------------------------------------
// Page access — the single source of truth for BOTH sidebar visibility and
// route guarding (keyed by route key). ('user' === regular employee.)
// ---------------------------------------------------------------------------
const ALL = ['user', 'manager', 'admin', 'owner'];

export const PAGE_ACCESS = {
  dashboard: ALL,
  timeclock: ALL,
  announcements: ALL,
  notifications: ALL,
  chat: ALL,
  tasks: ALL,
  forms: ALL,

  directory: ['manager', 'admin', 'owner'],
  scheduling: ['manager', 'admin', 'owner'],
  timesheets: ['manager', 'admin', 'owner'],
  reports: ['manager', 'admin', 'owner'],

  overtime: ['admin', 'owner'],
  knowledge: ['admin', 'owner'],
  helpdesk: ['admin', 'owner'],
  events: ['admin', 'owner'],

  audit: ['owner'],
};

// Can `role` access the page identified by `key`? Unknown keys default to allow.
export function canAccessPage(role, key) {
  const allowed = PAGE_ACCESS[key];
  return allowed ? allowed.includes(role) : true;
}
