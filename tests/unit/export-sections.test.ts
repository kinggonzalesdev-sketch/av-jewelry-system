import { describe, expect, it } from 'vitest';

import {
  ALL_EXPORT_SECTION_KEYS,
  EXPORT_SECTIONS,
  SENSITIVE_SECTION_KEYS,
  sectionsForRole,
  type ExportSectionKey,
} from '@/lib/export/sections';

/**
 * The Export section catalogue + the Owner-only gating (2026-09-07). The workbook builder and
 * the modal both drive off these constants, and the API route re-checks the role — so a
 * non-owner can never reach the sensitive sheets even by editing the request.
 */

describe('export sections catalogue', () => {
  it('lists the 11 original sheets plus the 5 additions in order', () => {
    expect(EXPORT_SECTIONS.map((s) => s.key)).toEqual([
      'inventory',
      'active_layaways',
      'completed_layaways',
      'all_layaways',
      'layaway_payments',
      'scrap',
      'all_sales',
      'orders',
      'payments',
      'customers',
      'attendance',
      'payroll',
      'daily_cash',
      'team',
      'permissions',
      'approvals',
      'audit',
      'capture_meta',
    ]);
  });

  it('marks exactly the personnel/audit/approvals/capture sheets sensitive (Owner-only)', () => {
    expect([...SENSITIVE_SECTION_KEYS].sort()).toEqual(
      ['approvals', 'audit', 'capture_meta', 'permissions', 'team'].sort(),
    );
  });

  it('layaway payment history is NOT sensitive (Owner + Selected Admin operational data)', () => {
    expect(SENSITIVE_SECTION_KEYS.has('layaway_payments')).toBe(false);
  });
});

describe('sectionsForRole', () => {
  it('gives the Owner every section', () => {
    expect(sectionsForRole(true)).toEqual(ALL_EXPORT_SECTION_KEYS);
  });

  it('hides every sensitive section from a non-owner', () => {
    const forAdmin = sectionsForRole(false);
    for (const key of SENSITIVE_SECTION_KEYS) {
      expect(forAdmin).not.toContain(key);
    }
    // …but keeps all the non-sensitive ones, including the new Layaway Payment History.
    const nonSensitive = ALL_EXPORT_SECTION_KEYS.filter(
      (k: ExportSectionKey) => !SENSITIVE_SECTION_KEYS.has(k),
    );
    expect(forAdmin).toEqual(nonSensitive);
    expect(forAdmin).toContain('layaway_payments');
  });
});
