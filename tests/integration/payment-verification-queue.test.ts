import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Payment Verification queue reads through PostgREST, not through SQL.
 *
 * THE DEFECT THIS GUARDS. `payments` has two foreign keys to `official_orders`
 * — official_order_id and reassigned_from_order_id (Phase 6 wrong-payment
 * correction). A bare `official_orders(...)` embed is therefore ambiguous, and
 * PostgREST refuses the ENTIRE request with PGRST201 rather than guessing which
 * order a payment belongs to. It is right to refuse: guessing would attribute a
 * payment to the order it was moved AWAY from.
 *
 * The queue then discarded the error (`const [{ data }] = await Promise.all`),
 * mapped null to [], and rendered "No payments awaiting verification" beside an
 * overview card reading 1. Nobody investigates an empty list.
 *
 * 370 database tests and 533 unit tests were green throughout, because none of
 * them went through PostgREST. These assertions are static — they read the query
 * text — which is the level the defect lives at: the SQL was fine, the embed
 * syntax was not.
 */

const projectRoot = join(__dirname, '..', '..');
const workspace = readFileSync(
  join(projectRoot, 'src', 'lib', 'payments', 'workspace.ts'),
  'utf8',
);

/** Strips comments. Every assertion below reads the QUERY, never the prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * A `.select(...)` body, by the function that owns it, comments removed.
 *
 * The comments inside these selects explain the ambiguity by NAMING the bare
 * `official_orders(...)` form they forbid. A test that read them would fail on
 * the very comment documenting the fix — and get "fixed" by deleting it.
 */
function selectBodyOf(fnName: string): string {
  const start = workspace.indexOf(`export async function ${fnName}`);
  expect(start, `${fnName} must exist`).toBeGreaterThan(-1);

  const next = workspace.indexOf('\nexport async function', start + 10);
  const body = workspace.slice(start, next === -1 ? undefined : next);

  const selectAt = body.indexOf('.select(');
  expect(selectAt, `${fnName} must issue a select`).toBeGreaterThan(-1);

  return stripComments(body.slice(selectAt, body.indexOf('`,', selectAt) + 1));
}

/** Every reader that embeds official_orders FROM payments. */
const PAYMENTS_EMBEDS = ['paymentVerificationQueue', 'paymentHistory'] as const;

describe('payments -> official_orders embeds name their foreign key', () => {
  it.each(PAYMENTS_EMBEDS)(
    '%s disambiguates the embed with the constraint name',
    (fn) => {
      const select = selectBodyOf(fn);

      // The bare form is what PostgREST refuses.
      expect(select).not.toMatch(/official_orders\s*\(/);
      expect(select).toMatch(/official_orders!payments_official_order_id_fkey/);
    },
  );

  it.each(PAYMENTS_EMBEDS)(
    '%s names the order the payment is FOR, not the one it was reassigned from',
    (fn) => {
      const select = selectBodyOf(fn);

      // Resolving to reassigned_from_order_id would attribute the payment to the
      // wrong order — the exact mistake PostgREST refused to make for us.
      expect(select).not.toMatch(/payments_reassigned_from_order_id_fkey/);
    },
  );
});

describe('the queue reports a failed read instead of an empty list', () => {
  const queueFn = (() => {
    const start = workspace.indexOf('export async function paymentVerificationQueue');
    const next = workspace.indexOf('\nexport async function', start + 10);
    return workspace.slice(start, next === -1 ? undefined : next);
  })();

  it('returns a discriminated result, not a bare array', () => {
    expect(queueFn).toMatch(/Promise<VerificationQueueResult>/);
    expect(workspace).toMatch(/export type VerificationQueueResult/);
  });

  it('handles the query error rather than destructuring it away', () => {
    // The original was `const [{ data }, duplicates] = await Promise.all([...])`
    // — the error had nowhere to go.
    expect(queueFn).not.toMatch(/const \[\{\s*data\s*\}/);
    expect(queueFn).toMatch(/if \(queue\.error\)/);
    expect(queueFn).toMatch(/return \{ ok: false, reason: queue\.error\.message \}/);
  });

  it('never maps a failed read to an empty array', () => {
    // `data ?? []` is only reachable AFTER the error branch returns.
    const errorBranch = queueFn.indexOf('if (queue.error)');
    const emptyFallback = queueFn.indexOf('queue.data ?? []');
    expect(errorBranch).toBeGreaterThan(-1);
    expect(emptyFallback).toBeGreaterThan(errorBranch);
  });

  it('carries the fields the verification decision needs', () => {
    for (const field of [
      'orderNumber',
      'invoiceNumber',
      'customerDisplayName',
      'amount',
      'paymentMethod',
      'referenceNumber',
      'recordedAt',
      'status',
      'evidenceReferences',
    ]) {
      expect(queueFn).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});

describe('the UI distinguishes an empty queue from a broken one', () => {
  const ui = readFileSync(
    join(projectRoot, 'src', 'components', 'payments', 'payments-workspace.tsx'),
    'utf8',
  );

  it('renders an explicit unavailable state', () => {
    expect(ui).toMatch(/queue-unavailable/);
    expect(ui).toMatch(/could not be read/i);
  });

  it('says plainly that an unavailable queue is not an empty one', () => {
    // The defect survived because "No payments awaiting verification" reads as
    // "nothing to do". The error state must refuse that reading out loud.
    expect(ui).toMatch(/not.*an empty queue/i);
  });

  it('only shows the empty state when the read SUCCEEDED', () => {
    expect(ui).toMatch(/!queueUnavailable \?/);
    // The empty-state element must sit behind the !queueUnavailable branch.
    const guard = ui.indexOf("tab === 'Payment Verification' && !queueUnavailable");
    const emptyState = ui.indexOf('No payments awaiting verification');
    expect(guard).toBeGreaterThan(-1);
    expect(emptyState).toBeGreaterThan(guard);
  });

  it('still computes no money in the browser', () => {
    // Every peso arrives already decided by the approved SQL.
    const queueBlock = ui.slice(
      ui.indexOf("tab === 'Payment Verification'"),
      ui.indexOf("tab === 'Layaway Accounts'"),
    );
    expect(queueBlock).not.toMatch(/parseFloat|parseInt|Number\(/);
  });
});
