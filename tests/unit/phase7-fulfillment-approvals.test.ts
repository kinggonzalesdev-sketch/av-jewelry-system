import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OWNER_APPROVAL_KINDS } from '@/lib/fulfillment/service';

/**
 * Phase 7 guards — Fulfillment & Owner Approval Center (Bible §18, §5.13, §22.13–22.14).
 *
 * The release rules and execute-once are structural and proven against a real
 * database in the pgTAP suite. These cover the TypeScript surface and the
 * boundaries that must not erode.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Owner approvals', () => {
  it('lists the non-delegable approvals (incl. customer_delete — Approvals Phase 2)', () => {
    expect(OWNER_APPROVAL_KINDS).toEqual([
      'official_order_cancellation',
      'layaway_forfeiture',
      'price_override',
      'exceptional_fulfillment_release',
      'live_batch_reopen',
      'wrong_payment_to_order_correction',
      // Approvals Phase 2 (2026-08-09): a non-owner's destructive deletes route here.
      'customer_delete',
      'inventory_item_delete',
      'scrap_sale_delete',
      'attendance_delete',
      // Approvals unification: the imported-layaway-ledger delete joins the SAME
      // queue as the others (was the separate deletion_requests register).
      'layaway_ledger_delete',
    ]);
  });

  it('has exactly eleven — nothing else may be smuggled in', () => {
    expect(OWNER_APPROVAL_KINDS).toHaveLength(11);
  });
});

describe('fulfillment service invariants', () => {
  const service = read('src', 'lib', 'fulfillment', 'service.ts');

  it('separates preparation from release by permission', () => {
    expect(service).toContain("requirePermission('fulfillment_preparation')");
    expect(service).toContain("requirePermission('fulfillment_release')");
  });

  it('keeps normal release permission-based, not Owner-only', () => {
    const release = service.slice(
      service.indexOf('export async function releaseFulfillment'),
      service.indexOf('export async function markDispatchedOrPickedUp'),
    );

    expect(release).toContain("requirePermission('fulfillment_release')");
    expect(release).not.toContain('requireOwnerApprovalAuthority');
  });

  it('gates the six approvals behind non-delegable Owner authority', () => {
    expect(service).toContain('requireOwnerApprovalAuthority');
  });

  it('never re-implements the release rules in TypeScript', () => {
    // A second copy could drift from the database, which is what actually
    // stands between an unpaid order and goods leaving.
    const release = service.slice(
      service.indexOf('export async function releaseFulfillment'),
      service.indexOf('export async function markDispatchedOrPickedUp'),
    );

    expect(release).not.toMatch(/1000|deposit_floor/);
    expect(release).not.toMatch(/verified_net_payments/);
  });

  it('states that preparation is not release', () => {
    expect(service).toContain('released: false');
  });

  it('states that a request executes nothing', () => {
    expect(service).toContain('executed: false');
    expect(service).toContain('requires_owner_decision: true');
  });

  it('re-validates stored state before executing an approval', () => {
    const execute = service.slice(
      service.indexOf('export async function executeOwnerApproval'),
    );

    expect(execute).toContain("from('owner_approval_requests')");
    expect(execute).toContain("request.status !== 'approved'");
    expect(execute).toContain('state_revalidated: true');
  });

  it('refuses to execute an already-executed approval', () => {
    expect(service).toMatch(/executes exactly once/i);
    expect(service).toContain("is('executed_at', null)");
  });

  it('never returns stock or auto-dispatches', () => {
    expect(service).toContain('auto_dispatched: false');
    expect(codeOnly(service)).not.toMatch(/returned_to_available|inventory_reservations/);
  });

  it('audits denial, not only success', () => {
    expect(service).toContain("outcome: 'denied'");
  });

  it('surfaces the database refusal rather than replacing it with a generic', () => {
    // The trigger's message names the exact rule that refused; a generic
    // "could not release" would hide which rule and why.
    expect(service).toContain("error.message.replace(/^ERROR:\\s*/i, '').trim()");
  });
});

describe('server actions delegate authority', () => {
  const actions = read('src', 'lib', 'fulfillment', 'actions.ts');

  it('holds no permission logic of its own', () => {
    expect(actions).not.toContain('requirePermission');
    expect(actions).not.toContain('requireOwner');
    expect(actions).not.toContain('roleKey');
  });

  it('never claims a request executed anything', () => {
    expect(actions).toMatch(/Requesting executes nothing/);
    expect(actions).toMatch(/Deciding is not executing/);
  });
});

describe('the screen never contradicts the rules', () => {
  const view = read(
    'src',
    'components',
    'fulfillment',
    'fulfillment-workspace.tsx',
  ).replace(/\s+/g, ' ');

  it('says preparing is not releasing and releasing is not dispatching', () => {
    expect(view).toMatch(/Preparing is not releasing, and releasing is not dispatching/i);
  });

  it('says normal release is not Owner-only', () => {
    expect(view).toMatch(/permission-based, not Owner-only/i);
  });

  it('marks the release preconditions as advisory', () => {
    expect(view).toMatch(/Advisory only — the database decides at release time/i);
  });

  it('says the six approvals are non-delegable', () => {
    expect(view).toMatch(/non-delegable/i);
    expect(view).toMatch(/no permission grants this/i);
  });

  it('says an approval executes exactly once', () => {
    expect(view).toMatch(/executes exactly once/i);
  });

  it('never promises automatic dispatch or completion', () => {
    expect(view).not.toMatch(/automatically dispatch|auto-complete/i);
  });
});

describe('Phase 7 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260715180000_phase7_fulfillment_owner_approvals.sql',
  );
  const sql = migration.replace(/^\s*--.*$/gm, '');

  it('defines the deposit floor once', () => {
    expect(sql).toContain('shipping_deposit_floor');
    expect(sql).toContain('1000.00::numeric');
  });

  it('requires verified payment before release', () => {
    expect(sql).toContain('verified_net_payments');
    expect(sql).toMatch(/Release requires verified payment/i);
  });

  it('treats a pending exceptional release as no release at all', () => {
    expect(sql).toMatch(/A request never releases goods/i);
    expect(sql).toContain("v_approval.status <> 'approved'");
  });

  it('freezes an executed approval rather than comparing timestamps', () => {
    // now() is constant within a transaction, so a retried execute writes an
    // IDENTICAL timestamp and a value comparison waves it through.
    expect(sql).toContain('if old.executed_at is not null then');
    expect(sql).not.toMatch(/new\.executed_at is distinct from old\.executed_at/);
  });

  it('makes a decision final', () => {
    expect(sql).toMatch(/A decision is final/i);
  });

  it('blocks auto dispatch and auto completion', () => {
    expect(sql).toContain('enforce_fulfillment_progression');
    expect(sql).toMatch(/Nothing completes automatically/i);
  });

  it('keeps every function security invoker with a pinned search_path', () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("set search_path = ''");
  });

  it('never weakens an earlier phase guard', () => {
    expect(sql).not.toMatch(/drop\s+trigger/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/disable row level security/i);
  });

  it('records the unresolved shipping policy as provisional', () => {
    expect(sql).toContain('provisional_fields');
    expect(migration).toContain('§18.25');
  });
});
