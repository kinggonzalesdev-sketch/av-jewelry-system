import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  permissionsForRole,
} from '@/lib/authz/permissions';

/**
 * Owner authorization rule (Bible §5, §5.13). Mirrors app_private.has_permission.
 */
describe('permissionsForRole', () => {
  it('gives the OWNER every permission, regardless of grants', () => {
    const owner = permissionsForRole('owner', []);
    expect(owner.size).toBe(ALL_PERMISSION_KEYS.length);
    for (const key of ALL_PERMISSION_KEYS) {
      expect(owner.has(key)).toBe(true);
    }
    // Concrete spot checks across module boundaries.
    expect(owner.has(PERMISSIONS.CLAIM_CAPTURE)).toBe(true);
    expect(owner.has(PERMISSIONS.PAYMENT_VERIFICATION)).toBe(true);
    expect(owner.has(PERMISSIONS.FULFILLMENT_RELEASE)).toBe(true);
    expect(owner.has(PERMISSIONS.EXPORT_DATA_REPORTS)).toBe(true);
  });

  it('gives Staff exactly its explicit grants — never more', () => {
    const staffFull = permissionsForRole('staff', [
      PERMISSIONS.CLAIM_CAPTURE,
      PERMISSIONS.PAYMENT_VERIFICATION,
      PERMISSIONS.FULFILLMENT_RELEASE,
    ]);
    expect(staffFull.has(PERMISSIONS.CLAIM_CAPTURE)).toBe(true);
    expect(staffFull.has(PERMISSIONS.PAYMENT_VERIFICATION)).toBe(true);
    // Not granted → not held. Role title is not authority for Staff.
    expect(staffFull.has(PERMISSIONS.EXPORT_DATA_REPORTS)).toBe(false);
    expect(staffFull.size).toBe(3);
  });

  it('gives Selected Admin exactly its explicit grants (role title is not authority)', () => {
    const admin = permissionsForRole('selected_admin', [PERMISSIONS.CLAIM_REVIEW]);
    expect(admin.has(PERMISSIONS.CLAIM_REVIEW)).toBe(true);
    expect(admin.has(PERMISSIONS.PAYMENT_VERIFICATION)).toBe(false);
    expect(admin.size).toBe(1);
  });

  it('gives a no-permission Staff account nothing', () => {
    expect(permissionsForRole('staff', []).size).toBe(0);
  });
});
