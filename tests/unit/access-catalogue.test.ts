import { describe, expect, it } from 'vitest';

import {
  ACCESS_MODULES,
  ALL_ACCESS_KEYS,
  applyModuleCascade,
  deriveModuleState,
} from '@/lib/authz/access-catalogue';
import { ALL_PERMISSION_KEYS } from '@/lib/authz/permissions';

describe('access catalogue — module shape', () => {
  it('offers the Owner-approved modules in order', () => {
    expect(ACCESS_MODULES.map((m) => m.title)).toEqual([
      'Dashboard & Profile',
      'Orders',
      'Inventory',
      'Customers',
      'Payments',
      'Layaway',
      'Scrap',
      'Reports',
      'Settings',
      'Team Management',
    ]);
  });

  it('maps every toggle to a REAL permission key (no phantom toggles)', () => {
    for (const key of ALL_ACCESS_KEYS) {
      expect(ALL_PERMISSION_KEYS, `${key} must be a real permission`).toContain(key);
    }
  });

  it('keeps every key distinct — a key is never offered twice', () => {
    expect(new Set(ALL_ACCESS_KEYS).size).toBe(ALL_ACCESS_KEYS.length);
  });

  it('has exactly one parentless module: Team Management (fixed rules)', () => {
    const parentless = ACCESS_MODULES.filter((m) => m.parent === null).map(
      (m) => m.title,
    );
    expect(parentless).toEqual(['Team Management']);
  });

  it('still offers the Layaway create/edit/delete actions', () => {
    const layaway = ACCESS_MODULES.find((m) => m.title === 'Layaway');
    expect(layaway?.children.map((c) => c.key)).toEqual([
      'layaway_create',
      'layaway_edit',
      'layaway_delete',
    ]);
  });
});

describe('applyModuleCascade — a child cannot outlive its parent', () => {
  it('drops children when their module parent is OFF', () => {
    // inventory_edit granted but nav_inventory (parent) absent → stripped.
    const out = applyModuleCascade(new Set(['inventory_edit', 'inventory_delete']));
    expect(out.has('inventory_edit')).toBe(false);
    expect(out.has('inventory_delete')).toBe(false);
  });

  it('keeps children when the parent is present', () => {
    const out = applyModuleCascade(new Set(['nav_inventory', 'inventory_edit']));
    expect(out.has('nav_inventory')).toBe(true);
    expect(out.has('inventory_edit')).toBe(true);
  });

  it('never cascades the parentless Team Management module', () => {
    // Payroll / Review Attendance stand alone — no parent can strip them.
    const out = applyModuleCascade(new Set(['hr_payroll', 'hr_review_attendance']));
    expect(out.has('hr_payroll')).toBe(true);
    expect(out.has('hr_review_attendance')).toBe(true);
  });
});

describe('deriveModuleState — normalise for display without stripping', () => {
  it('turns a module parent ON when any of its children is granted', () => {
    const out = deriveModuleState(new Set(['inventory_edit']));
    expect(out.has('nav_inventory')).toBe(true);
    expect(out.has('inventory_edit')).toBe(true);
  });

  it('leaves independent (Team Management) toggles as-is', () => {
    const out = deriveModuleState(new Set(['hr_payroll']));
    expect([...out]).toEqual(['hr_payroll']);
  });

  it('round-trips through cascade without losing an already-granted child', () => {
    const granted = new Set(['inventory_edit']);
    const effective = applyModuleCascade(deriveModuleState(granted));
    expect(effective.has('inventory_edit')).toBe(true);
    expect(effective.has('nav_inventory')).toBe(true);
  });
});
