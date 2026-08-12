// src/lib/permissions.js
// Pure, framework-free RBAC logic — the single source of truth for "who can do
// what". Kept free of React so it can be unit-tested directly (see
// permissions.test.js) and reused on the client and (conceptually) the server.
//
// Role hierarchy (low -> high): user < manager < admin < owner.
// `monitor` is a read-only, department-scoped viewer. It sits BELOW manager for
// capability purposes (so it can never create/edit/approve), and gets its page
// access via explicit PAGE_ACCESS entries + client-side department filtering.

export const ROLE_LEVELS = {
  user: 1,
  monitor: 1, // read-only viewer; intentionally below manager
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

// --- Monitor role (read-only, department-scoped) ---------------------------
export function isMonitor(role) {
  return role === 'monitor';
}

// Manager, admin or owner — explicitly EXCLUDES monitor (monitor is read-only).
export function isManagerOrAbove(role) {
  return role === 'manager' || role === 'admin' || role === 'owner';
}

// Only monitors are restricted to viewing their own department.
export function canViewDepartmentOnly(role) {
  return role === 'monitor';
}

// Who can approve/reject (timesheets, etc.)? Manager and above — not monitor.
export function canApprove(role) {
  return isManagerOrAbove(role);
}

// Who can CREATE a given resource?
//   shift        -> manager and above
//   announcement -> admin and above (managers are read-only)
//   form         -> admin and above
export function canCreate(role, resource = 'shift') {
  if (role === 'monitor') return false; // read-only
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
  if (role === 'monitor') return false; // read-only
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
  if (role === 'monitor') return false; // read-only
  return isAdmin(role);
}

// Access to the user-management area.
export function canManageUsers(role) {
  if (role === 'monitor') return false; // read-only
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
  if (isOwner(role)) return ['user', 'monitor', 'manager', 'admin', 'owner'];
  if (isAdmin(role)) return ['user', 'monitor', 'manager'];
  return [];
}

// ---------------------------------------------------------------------------
// Page access — the single source of truth for BOTH sidebar visibility and
// route guarding (keyed by route key). ('user' === regular employee.)
// ---------------------------------------------------------------------------
const ALL = ['user', 'manager', 'admin', 'owner'];
const ALL_M = ['user', 'manager', 'admin', 'owner', 'monitor']; // + read-only monitor

export const PAGE_ACCESS = {
  // Shared pages the monitor can also see.
  dashboard: ALL_M,
  timeclock: ALL_M,
  announcements: ALL_M,
  notifications: ALL_M,
  chat: ALL_M,
  tasks: ALL_M,

  // Forms stays employee+ but is HIDDEN from monitor.
  forms: ALL,

  // Manager-area pages the monitor may VIEW (department-scoped, read-only).
  directory: ['manager', 'admin', 'owner', 'monitor'],
  scheduling: ['manager', 'admin', 'owner', 'monitor'],
  timesheets: ['manager', 'admin', 'owner', 'monitor'],
  reports: ['manager', 'admin', 'owner', 'monitor'],
  overtime: ['admin', 'owner', 'monitor'],

  // Not for monitor.
  team_status: ['manager', 'admin', 'owner'],
  knowledge: ['admin', 'owner'],
  helpdesk: ['admin', 'owner'],
  events: ['admin', 'owner'],
  departments: ['admin', 'owner'],
  users: ['owner'],
  audit: ['owner'],
};

// Can `role` access the page identified by `key`? Unknown keys default to allow.
export function canAccessPage(role, key) {
  const allowed = PAGE_ACCESS[key];
  return allowed ? allowed.includes(role) : true;
}
