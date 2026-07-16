import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RANGE_LABEL, moneyString } from '@/lib/payments/format';
import { resolveRange } from '@/lib/payments/workspace';
import { TABS } from '@/components/payments/payments-workspace';

/**
 * Phase 6 production UI wiring guards (Bible §16, §17).
 *
 * The approved module is frozen: these lock the tabs, the filters, and the rules
 * the screen must never contradict — above all that financial truth is never
 * computed in the client.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('approved module shape is preserved', () => {
  it('keeps the seven approved tabs, in order', () => {
    expect(TABS).toEqual([
      'Payment Verification',
      'Layaway Accounts',
      'Installments',
      'Overdue / Grace Period',
      'Forfeiture Review',
      'Payment History',
      'Completed Layaways',
    ]);
  });

  it('offers all six approved date filters', () => {
    expect(Object.values(RANGE_LABEL)).toEqual([
      'Today',
      '7 Days',
      '14 Days',
      '30 Days',
      'This Month',
      'Custom Date Range',
    ]);
  });

  it('keeps Payments & Layaway inside the Orders group, not a sixth nav item', () => {
    const page = read('src', 'app', '(app)', 'orders', 'payments', 'page.tsx');
    expect(page).toMatch(/sub-route of the Orders group/i);
  });

  it('names the module Payments & Layaway', () => {
    const page = read('src', 'app', '(app)', 'orders', 'payments', 'page.tsx');
    // The title is now a PageHeader string prop, so the ampersand is raw — not
    // the &amp; HTML entity it needed when it was JSX text.
    expect(page).toContain('Payments & Layaway');
  });
});

describe('date range is resolved server-side', () => {
  it('produces bounds for every approved range', () => {
    for (const key of ['today', '7d', '14d', '30d', 'month'] as const) {
      const { start, end } = resolveRange(key);
      expect(new Date(start).getTime()).toBeLessThanOrEqual(new Date(end).getTime());
    }
  });

  it('honours a custom range', () => {
    const { start, end } = resolveRange('custom', '2026-07-01', '2026-07-10');
    expect(start.startsWith('2026-07-01')).toBe(true);
    expect(end.startsWith('2026-07-10')).toBe(true);
  });

  it('validates the requested range against the approved list', () => {
    // A client cannot widen the window to something unapproved.
    const page = read('src', 'app', '(app)', 'orders', 'payments', 'page.tsx');
    expect(page).toContain('VALID_RANGES.includes');
  });
});

describe('money never becomes a float', () => {
  it('refuses to stringify an unexpected object into a peso field', () => {
    // String(unknown) would render "[object Object]" inside a money field,
    // which is worse than failing.
    expect(moneyString({})).toBe('0.00');
    expect(moneyString(null)).toBe('0.00');
    expect(moneyString(undefined)).toBe('0.00');
  });

  it('passes a numeric string through untouched', () => {
    expect(moneyString('10750.00')).toBe('10750.00');
    expect(moneyString('0.01')).toBe('0.01');
  });

  it('never uses parseFloat or arithmetic on a peso value', () => {
    const workspace = codeOnly(read('src', 'lib', 'payments', 'workspace.ts'));

    expect(workspace).not.toMatch(/parseFloat/);
    // Sums are done in integer centavos via BigInt, never with floats.
    expect(workspace).toContain('BigInt');
    expect(workspace).toContain('toCentavos');
  });

  it('computes no balance in the client component', () => {
    const view = codeOnly(
      read('src', 'components', 'payments', 'payments-workspace.tsx'),
    );

    expect(view).not.toMatch(/parseFloat|Number\(/);
    expect(view).not.toMatch(/outstanding\s*[-+*/]=/);
  });
});

describe('the screen never contradicts the approved financial rules', () => {
  // Prettier reflows JSX prose across lines, so collapse whitespace before
  // matching sentences — the assertion is about the words, not the wrapping.
  const view = read('src', 'components', 'payments', 'payments-workspace.tsx').replace(
    /\s+/g,
    ' ',
  );
  const workspace = read('src', 'lib', 'payments', 'workspace.ts');

  it('reads every balance from the approved SQL', () => {
    expect(workspace).toContain("rpc('order_balance'");
  });

  it('counts only verified, non-void, non-reversed payments as collected', () => {
    const trend = workspace.slice(
      workspace.indexOf('export async function layawayCollectionTrend'),
      workspace.indexOf('function toCentavos'),
    );

    expect(trend).toContain("eq('status', 'verified')");
    expect(trend).toContain("is('voided_at', null)");
    expect(trend).toContain("is('reversed_at', null)");
    expect(trend).toContain("eq('correction_pending', false)");
  });

  it('keeps evidence separate from verified in the breakdown', () => {
    expect(workspace).toContain("label: 'Evidence Submitted'");
    expect(workspace).toContain("label: 'Required Payment Verified'");
    expect(view).toMatch(/never folded into Required\s*\n?\s*Payment Verified/);
  });

  it('states that recording evidence is not verifying', () => {
    expect(view).toMatch(/Recording evidence is not verifying/i);
  });

  it('states that Required Payment Verified is not Paid in Full', () => {
    expect(view).toMatch(/Required Payment Verified is not Paid in Full/i);
  });

  it('flags a duplicate reference rather than hiding it', () => {
    expect(view).toMatch(/Duplicate transaction reference/i);
    expect(view).toMatch(/not auto-rejected/i);
  });

  it('says installment recording does not verify the payment', () => {
    expect(view).toMatch(/Recorded — not yet verified/);
    expect(view).toMatch(/not a verified payment/i);
  });

  it('keeps unresolved overpayment and correction visible', () => {
    expect(view).toMatch(/Overpayment Credit/);
    expect(view).toMatch(/Completion\s*\n?\s*is blocked/i);
    expect(view).toMatch(/correction is unresolved/i);
  });

  it('never promises automatic forfeiture or stock return', () => {
    expect(view).toMatch(/no automatic forfeiture and no automatic stock return/i);
    expect(view).toMatch(/Requesting is not forfeiting/i);
    expect(view).toMatch(/Returned-to-Stock Review/);
  });
});

describe('server actions delegate authority', () => {
  const actions = read('src', 'lib', 'payments', 'actions.ts');
  const layaway = read('src', 'lib', 'payments', 'layaway.ts');

  it('holds no permission logic of its own', () => {
    // Authority lives in the domain modules and the database.
    expect(actions).not.toContain('requirePermission');
    expect(actions).not.toContain('roleKey');
  });

  it('re-reads the 20% threshold from the database, not the form', () => {
    expect(layaway).toContain("rpc('order_balance'");
    expect(layaway).toContain('verified < required');
  });

  it('refuses activation on an unverified deposit', () => {
    expect(layaway).toMatch(/Evidence alone does not activate a Layaway/);
  });

  it('gates forfeiture decisions behind non-delegable Owner authority', () => {
    expect(layaway).toContain('requireOwnerApprovalAuthority');
  });

  it('never forfeits or returns stock from a request', () => {
    expect(layaway).toContain('forfeited: false');
    expect(layaway).toContain('stock_returned: false');
  });

  it('audits denial, not just success', () => {
    expect(layaway).toContain("outcome: 'denied'");
  });
});

describe('preview isolation holds', () => {
  it('imports no preview-only module into the production payments UI', () => {
    for (const file of [
      join('src', 'components', 'payments', 'payments-workspace.tsx'),
      join('src', 'lib', 'payments', 'workspace.ts'),
      join('src', 'app', '(app)', 'orders', 'payments', 'page.tsx'),
    ]) {
      const source = readFileSync(join(projectRoot, file), 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*components\/preview/);
    }
  });
});
