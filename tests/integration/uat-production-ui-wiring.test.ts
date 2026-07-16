import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * UAT production-UI completion — every path is reachable, and reaches the right layer.
 *
 * WHY THIS FILE EXISTS. Phase 11 claimed "12 of 14 UAT scenarios testable". That
 * claim was wrong, and the way it was wrong is the point: every rule was proven
 * in the database, every domain module was tested, and `recordPayment()` still
 * had no button. A tested function nobody can reach does not make a workflow
 * usable — and nothing in the suite noticed, because nothing asserted that the
 * UI reaches the domain at all.
 *
 * So these tests assert the JOIN between the two layers: for each production
 * path, an action exists, a component calls it, and a route renders that
 * component. They are static assertions over the whole tree on purpose — a
 * mocked render proves the module you mocked; this proves no path was left
 * stranded, including ones a future phase adds.
 */

const projectRoot = join(__dirname, '..', '..');
const srcRoot = join(projectRoot, 'src');

function read(relative: string): string {
  return readFileSync(join(srcRoot, relative), 'utf8');
}

/**
 * Source with comments removed.
 *
 * Every "this must NOT appear" assertion below reads code, never prose. The
 * first draft of this file did the opposite and failed four times — on the
 * comment explaining that there is no CVV field, on the comment explaining why
 * Date.now() is not used, and so on. A rule stated in a comment is not a
 * violation of that rule, and a test that cannot tell the difference punishes
 * the very comments that explain the constraint.
 */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function srcFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: srcRoot }).map((p) => p.replace(/\\/g, '/'));
}

/** Every file under src, for "is this symbol referenced anywhere" questions. */
const ALL_SOURCES = srcFiles('**/*.{ts,tsx}').map((f) => ({ file: f, text: read(f) }));

function referencedBy(symbol: string, predicate: (file: string) => boolean): string[] {
  const re = new RegExp(`\\b${symbol}\\b`);
  return ALL_SOURCES.filter((s) => predicate(s.file) && re.test(s.text)).map(
    (s) => s.file,
  );
}

const isComponent = (f: string) => f.startsWith('components/');
const isRoute = (f: string) => f.startsWith('app/');

/**
 * The production paths UAT-12 walks, end to end.
 *
 * Each row is: a server action, the domain function it must delegate to, and the
 * action module that owns it. If any row loses its component, UAT-12 breaks at
 * that step — which is exactly how this was missed the first time.
 */
const UAT12_PATH = [
  {
    step: 'Current Flex Item',
    action: 'setCurrentFlexItemAction',
    domain: 'setCurrentFlexItem',
    module: 'lib/live/actions.ts',
  },
  {
    step: 'Pending Claim (capture)',
    action: 'captureClaimAction',
    domain: 'captureClaim',
    module: 'lib/live/actions.ts',
  },
  {
    step: 'Confirm Claim & Print Label',
    action: 'confirmClaimAction',
    domain: 'confirmClaimAndPrint',
    module: 'lib/claims/actions.ts',
  },
  {
    step: 'Approve & Send Invoice',
    action: 'approveAndSendAction',
    domain: 'approveAndSendInvoice',
    module: 'lib/invoicing/actions.ts',
  },
  {
    step: 'Record Payment Evidence',
    action: 'recordPaymentAction',
    domain: 'recordPayment',
    module: 'lib/payments/actions.ts',
  },
  {
    step: 'Verify Payment',
    action: 'verifyPaymentAction',
    domain: 'verifyPayment',
    module: 'lib/payments/actions.ts',
  },
  {
    step: 'Prepare Fulfillment',
    action: 'prepareFulfillmentAction',
    domain: 'prepareFulfillment',
    module: 'lib/fulfillment/actions.ts',
  },
  {
    step: 'Release',
    action: 'releaseFulfillmentAction',
    domain: 'releaseFulfillment',
    module: 'lib/fulfillment/actions.ts',
  },
  {
    step: 'Dispatch / pick up',
    action: 'dispatchAction',
    domain: 'markDispatchedOrPickedUp',
    module: 'lib/fulfillment/actions.ts',
  },
  {
    step: 'Complete',
    action: 'completeFulfillmentAction',
    domain: 'completeFulfillment',
    module: 'lib/fulfillment/actions.ts',
  },
] as const;

describe('UAT-12 is executable through the production UI', () => {
  it.each(UAT12_PATH)(
    '$step: $action delegates to $domain()',
    ({ action, domain, module }) => {
      const text = read(module);
      expect(text).toMatch(new RegExp(`export async function ${action}\\b`));
      // The action must call the domain function — not re-implement the rule.
      expect(text).toMatch(new RegExp(`\\b${domain}\\(`));
    },
  );

  it.each(UAT12_PATH)('$step: a component actually calls $action', ({ action }) => {
    expect(referencedBy(action, isComponent).length).toBeGreaterThan(0);
  });

  it('every step of the UAT-12 path is reachable — no manual database edit', () => {
    const stranded = UAT12_PATH.filter(
      (s) => referencedBy(s.action, isComponent).length === 0,
    );
    expect(stranded.map((s) => s.step)).toEqual([]);
  });
});

describe('label actions are reachable (Bible §24)', () => {
  // retryPrint belongs to a FAILED job; reprint deliberately prints again one
  // that already succeeded; void cancels the paper. All three had to be
  // reachable, and void was not.
  it.each(['retryPrintAction', 'reprintLabelAction', 'voidLabelJobAction'])(
    '%s is called by the Claim Review UI',
    (action) => {
      expect(referencedBy(action, isComponent)).toContain(
        'components/claims/claim-review-view.tsx',
      );
    },
  );

  it('voiding a label is wired to voidLabelJob(), which touches paper only', () => {
    const actions = read('lib/claims/actions.ts');
    expect(actions).toMatch(/export async function voidLabelJobAction\b/);
    expect(actions).toMatch(/\bvoidLabelJob\(/);
    // The message must not imply the claim or reservation moved.
    expect(actions).toMatch(/claim stands/i);
  });
});

describe('Record Payment records evidence and never verifies (§16, approved §3)', () => {
  const actions = read('lib/payments/actions.ts');
  const RECORD_FORM = 'components/payments/record-payment-form.tsx';
  const form = read(RECORD_FORM);

  it('delegates to recordPayment() rather than writing payments itself', () => {
    expect(actions).toMatch(/\brecordPayment\(/);
    expect(actions).not.toMatch(/from\('payments'\)/);
  });

  it('cannot set a status or a verified amount — recording is not verifying', () => {
    const action = actions.slice(actions.indexOf('recordPaymentAction'));
    const body = action.slice(0, action.indexOf('\n}'));
    expect(body).not.toMatch(/status:/);
    expect(body).not.toMatch(/verifiedAmount/);
    expect(body).not.toMatch(/paidInFull|paid_in_full/);
  });

  it('tells the operator the payment is unverified', () => {
    expect(actions).toMatch(/UNVERIFIED/);
    expect(actions).toMatch(/counts toward no balance/i);
  });

  it('surfaces the duplicate-reference warning instead of hiding it', () => {
    expect(actions).toMatch(/duplicateReferenceFlagged/);
    expect(form).toMatch(/duplicate-reference-warning/);
    // Flagged, never rejected (§3) — refusing it would hide the collision.
    expect(form).toMatch(/flagged for review, not rejected/i);
  });

  it('has no FIELD for card number, CVV, or PIN (approved §3)', () => {
    // Asserts on the form's actual field names, not on prose. Both the comment
    // and the on-screen warning name these values precisely in order to forbid
    // them — "never enter a CVV" is the rule being honoured, not broken. A test
    // that cannot tell a field from a warning would delete the warning.
    const fieldNames = [...read(RECORD_FORM).matchAll(/name="([^"]+)"/g)].map(
      (m) => m[1],
    );

    expect(fieldNames.length).toBeGreaterThan(5);

    for (const name of fieldNames) {
      expect(name).not.toMatch(/card|cvv|cvc|^pin$|secret|password/i);
    }
  });

  it('reads no card data out of the submitted form', () => {
    // The action's own view of the request: nothing card-shaped is pulled from
    // FormData, so a crafted POST cannot smuggle one through either.
    const read_ = [
      ...code('lib/payments/actions.ts').matchAll(/text\(formData,\s*'([^']+)'\)/g),
    ].map((m) => m[1]);

    for (const field of read_) {
      expect(field).not.toMatch(/card|cvv|cvc|^pin$|secret|password/i);
    }
  });

  it('warns the operator on screen never to enter card data', () => {
    // The warning is REQUIRED, and is the reason the assertions above read
    // fields rather than text.
    expect(form).toMatch(/never enter a card number, cvv, or pin/i);
  });

  it('renders the order facts a payment decision needs', () => {
    for (const field of [
      'orderNumber',
      'invoiceNumber',
      'customerDisplayName',
      'totalAmountPayable',
      'verifiedNetPayments',
      'outstandingBalance',
    ]) {
      expect(form).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('computes no money in the browser — every figure arrives decided', () => {
    // No arithmetic on money in the form. A float would round a centavo off a
    // balance that decides whether a customer still owes money.
    expect(form).not.toMatch(/parseFloat|parseInt|Number\(/);
  });
});

describe('Prepare Fulfillment prepares and never releases (Bible §18)', () => {
  const actions = read('lib/fulfillment/actions.ts');
  const form = read('components/fulfillment/prepare-fulfillment-form.tsx');

  it('delegates to prepareFulfillment()', () => {
    expect(actions).toMatch(/\bprepareFulfillment\(/);
  });

  it('the prepare action cannot release, dispatch, or complete', () => {
    const start = actions.indexOf('export async function prepareFulfillmentAction');
    const body = actions.slice(
      start,
      actions.indexOf('export async function', start + 10),
    );
    expect(body).not.toMatch(
      /releaseFulfillment\(|markDispatchedOrPickedUp\(|completeFulfillment\(/,
    );
  });

  it('says plainly that preparing is not releasing', () => {
    expect(form).toMatch(/not.*releasing/i);
  });

  it('shows release eligibility as advisory, not as a decision', () => {
    expect(form).toMatch(/meetsDepositFloor/);
    expect(form).toMatch(/verifiedNetPayments/);
  });

  it('marking COD does not approve COD', () => {
    expect(form).toMatch(/does not approve/i);
  });
});

describe('Staff administration is a real console (Bible §5.13, §30.5)', () => {
  const actions = read('lib/authz/actions.ts');
  const console_ = read('components/admin/staff-console.tsx');

  const WIRED = [
    ['grantPermissionAction', 'grantPermission'],
    ['revokePermissionAction', 'revokePermission'],
    ['deactivateAccountAction', 'deactivateAccount'],
    ['reactivateAccountAction', 'reactivateAccount'],
    ['setSelectedAdminAction', 'setSelectedAdminStatus'],
    ['assignScopeAction', 'assignScope'],
    ['removeScopeAction', 'removeScope'],
  ] as const;

  it.each(WIRED)('%s delegates to %s()', (action, domain) => {
    expect(actions).toMatch(new RegExp(`export async function ${action}\\b`));
    expect(actions).toMatch(new RegExp(`\\b${domain}\\(`));
  });

  it.each(WIRED)('%s is called by the console', (action) => {
    expect(console_).toMatch(new RegExp(`\\b${action}\\b`));
  });

  it('the staff route renders the console', () => {
    expect(referencedBy('StaffConsole', isRoute)).toContain(
      'app/(app)/admin/staff/page.tsx',
    );
  });

  it('only catalog permissions may be granted — never a free-text string', () => {
    // A free-text grant would let a typo create a permission that no guard
    // checks, which reads as "granted" and enforces nothing.
    expect(actions).toMatch(/asPermissionKey/);
    expect(actions).toMatch(/PERMISSIONS/);
    expect(actions).toMatch(/not a permission in the approved catalog/);
  });

  it('states that a new account has zero grants and a title grants nothing', () => {
    expect(console_).toMatch(/zero/i);
    expect(console_).toMatch(/title (adds|grants) no/i);
  });

  it('states that assignment is not permission', () => {
    expect(actions).toMatch(/Assignment is not permission/i);
    expect(console_).toMatch(/narrows/i);
  });

  it('enforces the two-Selected-Admin cap in the UI and defers to the database', () => {
    expect(console_).toMatch(/MAX_SELECTED_ADMINS\s*=\s*2/);
    // The cap is the database's; the screen only avoids offering a doomed click.
    expect(console_).toMatch(/enforced by the database|database/i);
  });

  it('deactivation requires a reason and preserves history', () => {
    expect(actions).toMatch(/requires a reason/i);
    expect(actions).toMatch(/audit history are preserved|history.*preserved/i);
  });

  it('exposes an audit trail per account', () => {
    expect(console_).toMatch(/audit-trail/);
    expect(read('lib/authz/account-management.ts')).toMatch(
      /export async function listAccountAuditTrail\b/,
    );
  });

  it('does NOT wire staff invitation — it needs the service-role key', () => {
    // Not an oversight. inviteStaffAccount() needs the Admin API and the
    // service-role key, which bypasses RLS entirely and is deliberately unwired
    // (ADR §11). It is the one path that can mint credentials, so it stays an
    // explicit decision rather than a side-effect of a UI pass.
    expect(actions).not.toMatch(/\binviteStaffAccount\b\s*\(/);
    expect(actions).toMatch(/service-role/i);
    expect(console_).toMatch(/service-role/i);
  });

  it('never handles a password or the service-role key in the console', () => {
    for (const text of [actions, console_]) {
      expect(text).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role_key/);
      expect(text).not.toMatch(/name="password"/);
    }
  });
});

describe('Live capture creates a Pending Claim only (Bible §12.3, §13.2)', () => {
  const actions = read('lib/live/actions.ts');
  const CAPTURE_PANEL = 'components/live/live-capture-panel.tsx';
  const panel = read(CAPTURE_PANEL);

  it('captureClaimAction delegates to captureClaim()', () => {
    expect(actions).toMatch(/\bcaptureClaim\(/);
  });

  it('the capture panel is rendered by the live route', () => {
    expect(referencedBy('LiveCapturePanel', isComponent)).toContain(
      'components/live/live-batches-view.tsx',
    );
    expect(referencedBy('LiveBatchesView', isRoute)).toContain('app/(app)/live/page.tsx');
  });

  it('capture never confirms, reserves, prints, or creates an order', () => {
    const start = actions.indexOf('export async function captureClaimAction');
    const body = actions.slice(start);
    expect(body).not.toMatch(/confirmClaimAndPrint\(|approve_and_send|createOrder/i);
    expect(panel).toMatch(/Pending Claim only/i);
    expect(panel).toMatch(/No stock is\s*\n?\s*reserved|reserves nothing|no stock/i);
  });

  it('sends a STABLE idempotency key so a double tap returns the same claim', () => {
    expect(panel).toMatch(/idempotencyKey/);
    // A clock read or a random would produce a new key on every render and
    // defeat the deduplication the key exists to provide. Read code, not the
    // comment that explains this.
    expect(code(CAPTURE_PANEL)).not.toMatch(/Date\.now\(\)|Math\.random\(\)/);
    expect(code(CAPTURE_PANEL)).toMatch(/useId\(\)/);
  });

  it('states that a flex switch affects future capture only', () => {
    expect(panel).toMatch(/future capture only/i);
  });
});

describe('the UI still never becomes the authorization control (§30.3 r2)', () => {
  it('every new action module delegates rather than querying the database', () => {
    for (const file of [
      'lib/authz/actions.ts',
      'lib/payments/actions.ts',
      'lib/live/actions.ts',
    ]) {
      const text = read(file);
      expect(text).not.toMatch(/supabase\/server|createClient\(/);
    }
  });

  it('the new client components hold no permission logic of their own', () => {
    for (const file of [
      'components/payments/record-payment-form.tsx',
      'components/fulfillment/prepare-fulfillment-form.tsx',
      'components/admin/staff-console.tsx',
      'components/live/live-capture-panel.tsx',
    ]) {
      // Code only. These files document that requireOwner() is the real control;
      // saying so is the opposite of re-implementing it.
      expect(code(file)).not.toMatch(
        /requirePermission\(|requireOwner\(|has_permission\(/,
      );
    }
  });
});
