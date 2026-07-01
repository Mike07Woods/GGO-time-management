// src/lib/permissions.test.js
// Unit tests for the RBAC matrix. Run with: npm test

import {
  roleLevel,
  isAtLeast,
  isManager,
  isAdmin,
  isOwner,
  canCreate,
  canEdit,
  canDelete,
  canManageUsers,
  canManageUser,
  assignableRoles,
} from './permissions';

const ROLES = ['user', 'manager', 'admin', 'owner'];

describe('role hierarchy', () => {
  test('roleLevel orders roles correctly', () => {
    expect(roleLevel('user')).toBe(1);
    expect(roleLevel('manager')).toBe(2);
    expect(roleLevel('admin')).toBe(3);
    expect(roleLevel('owner')).toBe(4);
  });

  test('unknown / missing role is level 0', () => {
    expect(roleLevel('intern')).toBe(0);
    expect(roleLevel(null)).toBe(0);
    expect(roleLevel(undefined)).toBe(0);
  });

  test('isAtLeast respects the hierarchy', () => {
    expect(isAtLeast('manager', 'manager')).toBe(true);
    expect(isAtLeast('admin', 'manager')).toBe(true);
    expect(isAtLeast('user', 'manager')).toBe(false);
    expect(isAtLeast('owner', 'admin')).toBe(true);
  });

  test('convenience flags', () => {
    expect(ROLES.map(isManager)).toEqual([false, true, true, true]);
    expect(ROLES.map(isAdmin)).toEqual([false, false, true, true]);
    expect(ROLES.map(isOwner)).toEqual([false, false, false, true]);
  });
});

describe('canCreate', () => {
  test('shifts: manager and above', () => {
    expect(canCreate('user', 'shift')).toBe(false);
    expect(canCreate('manager', 'shift')).toBe(true);
    expect(canCreate('admin', 'shift')).toBe(true);
    expect(canCreate('owner', 'shift')).toBe(true);
  });

  test('announcements & forms: admin and above (managers are read-only)', () => {
    for (const resource of ['announcement', 'form']) {
      expect(canCreate('manager', resource)).toBe(false);
      expect(canCreate('admin', resource)).toBe(true);
      expect(canCreate('owner', resource)).toBe(true);
    }
  });

  test('defaults to shift rule when no resource given', () => {
    expect(canCreate('manager')).toBe(true);
    expect(canCreate('user')).toBe(false);
  });
});

describe('canEdit / canDelete', () => {
  test('canEdit shift: manager+', () => {
    expect(canEdit('manager', 'shift')).toBe(true);
    expect(canEdit('user', 'shift')).toBe(false);
  });

  test('canEdit user/profile/announcement: admin+', () => {
    for (const resource of ['user', 'profile', 'announcement']) {
      expect(canEdit('manager', resource)).toBe(false);
      expect(canEdit('admin', resource)).toBe(true);
    }
  });

  test('canDelete: admin+ only', () => {
    expect(ROLES.map(canDelete)).toEqual([false, false, true, true]);
  });
});

describe('user management', () => {
  test('canManageUsers: admin+ only', () => {
    expect(ROLES.map(canManageUsers)).toEqual([false, false, true, true]);
  });

  test('owner can manage anyone', () => {
    for (const target of ROLES) {
      expect(canManageUser('owner', target)).toBe(true);
    }
  });

  test('admin can manage users/managers but NOT admins/owners', () => {
    expect(canManageUser('admin', 'user')).toBe(true);
    expect(canManageUser('admin', 'manager')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('admin', 'owner')).toBe(false);
  });

  test('manager and user can manage no one', () => {
    for (const target of ROLES) {
      expect(canManageUser('manager', target)).toBe(false);
      expect(canManageUser('user', target)).toBe(false);
    }
  });

  test('assignableRoles: owner=all, admin=user/manager, others=none', () => {
    expect(assignableRoles('owner')).toEqual(['user', 'manager', 'admin', 'owner']);
    expect(assignableRoles('admin')).toEqual(['user', 'manager']);
    expect(assignableRoles('manager')).toEqual([]);
    expect(assignableRoles('user')).toEqual([]);
  });

  test('admin cannot escalate anyone to admin/owner via assignableRoles', () => {
    const assignable = assignableRoles('admin');
    expect(assignable).not.toContain('admin');
    expect(assignable).not.toContain('owner');
  });
});
