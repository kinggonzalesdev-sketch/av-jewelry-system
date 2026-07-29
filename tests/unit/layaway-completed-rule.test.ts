import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Locks the Completed-Layaway rule against the two regressions it has already had.
 *
 * The rule is: a record whose status is Completed (in ANY casing) belongs under
 * Completed Layaways when nothing is still owed. It must NOT additionally require
 * a non-zero grand total — most imported historical accounts closed long ago and
 * carry no money columns at all, and a `grand > 0` guard silently hid 191 of 199
 * real completed records.
 */
const source = readFileSync(
  join(process.cwd(), 'src/components/payments/payments-workspace.tsx'),
  'utf8',
);

describe('Completed Layaways — inclusion rule', () => {
  it('compares status case-insensitively so COMPLETED and Completed are one status', () => {
    expect(source).toMatch(/function normStatus/);
    expect(source).toMatch(/status\.trim\(\)\.toLowerCase\(\)/);
    expect(source).toMatch(/function isCompletedStatus/);
  });

  it('does NOT require a non-zero grand total (that hid imported historical records)', () => {
    const rule = source.slice(
      source.indexOf('function isValidCompletedRow'),
      source.indexOf('function financerOf'),
    );
    expect(rule).not.toMatch(/grand > 0n/);
  });

  it('treats "nothing owed" as completed, including a small overpayment', () => {
    const rule = source.slice(
      source.indexOf('function isValidCompletedRow'),
      source.indexOf('function financerOf'),
    );
    expect(rule).toMatch(/balance <= 0n/);
    expect(rule).toMatch(/paid >= grand/);
  });

  it('keeps completed records OUT of Active — completed is a terminal status', () => {
    expect(source).toMatch(/TERMINAL_STATUSES = new Set\(\['completed', 'forfeited', 'cancelled'\]\)/);
    // Active excludes terminal statuses and overdue.
    expect(source).toMatch(/!TERMINAL_STATUSES\.has\(normStatus\(r\.status\)\) && !overdue/);
  });

  it('excludes Needs Review rows everywhere', () => {
    expect(source).toMatch(/EXCLUDED_STATUSES = new Set\(\['needs_review'\]\)/);
    expect(source).toMatch(/!EXCLUDED_STATUSES\.has\(normStatus\(r\.status\)\)/);
  });
});
