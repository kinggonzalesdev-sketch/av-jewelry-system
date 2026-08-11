import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FREED_UNIT_OUTCOMES } from '@/lib/inventory/service';

/**
 * Phase 8 guards — Inventory, Returned-to-Stock, Customers & Migration
 * (Bible §19, §10, §22.15–22.16).
 *
 * The return rule, the no-auto-merge rule, and migration provenance are
 * structural and proven against a real database in the pgTAP suite. These cover
 * the TypeScript surface and the wording the screen must not contradict.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('freed-unit outcomes', () => {
  it('offers the approved outcomes, and both allocation paths are REVIEWS', () => {
    expect(FREED_UNIT_OUTCOMES).toEqual([
      'returned_to_available',
      'offered_to_second_miner_for_review',
      'sent_to_waitlist_for_review',
      'held_unavailable',
    ]);
  });

  it('never offers an outcome that allocates directly', () => {
    // "offered_to_second_miner_for_review" is a review, not a gift. An outcome
    // like "promote_second_miner" would be automatic promotion by another name.
    for (const outcome of FREED_UNIT_OUTCOMES) {
      expect(outcome).not.toMatch(/^promote|^allocate|^assign/);
    }
  });
});

describe('inventory service invariants', () => {
  const service = read('src', 'lib', 'inventory', 'service.ts');

  it('derives availability from the database, never a stored counter', () => {
    expect(service).toContain("rpc('inventory_monitor')");
    expect(codeOnly(service)).not.toMatch(/available\s*=\s*.*[-+]/);
  });

  it('never promotes a miner or allocates a waitlist when deciding a review', () => {
    expect(codeOnly(service)).not.toContain('miner_positions');
    expect(codeOnly(service)).not.toContain('waitlist_entries');
    expect(service).toContain('miner_promoted: false');
    expect(service).toContain('waitlist_allocated: false');
  });

  it('keeps returning to available a separate step from approving the review', () => {
    expect(service).toContain('export async function decideRtsReview');
    expect(service).toContain('export async function returnItemToAvailable');
  });

  it('never merges customers, not even when judged duplicate', () => {
    const review = service.slice(
      service.indexOf('export async function reviewDuplicate'),
      service.indexOf('export async function openMigrationBatch'),
    );

    // Judging records a verdict on the REFERENCE row. It must never delete a
    // customer or rewrite one — that is what a merge would be.
    expect(review).not.toContain('.delete(');
    expect(review).not.toMatch(/from\('customers'\)/);
    // And the trail must say so out loud.
    expect(service).toContain('customers_merged: false');
    expect(service).toContain("merge_mechanics: 'deferred_post_v1'");
  });

  it('states that migration creates no claims', () => {
    expect(service).toContain('creates_claims: false');
    expect(service).toContain('separate_from_live_intake: true');
  });

  it('gates each action behind its own permission', () => {
    expect(service).toContain("requirePermission('inventory_monitoring')");
    expect(service).toContain("requirePermission('claim_review')");
    expect(service).toContain("requirePermission('existing_record_entry')");
  });

  it('surfaces the database refusal rather than a generic message', () => {
    expect(service).toContain("error.message.replace(/^ERROR:\\s*/i, '').trim()");
  });

  it('audits denial, not only success', () => {
    expect(service).toContain("outcome: 'denied'");
  });
});

describe('the screen never contradicts the rules', () => {
  const view = read('src', 'components', 'inventory', 'inventory-workspace.tsx').replace(
    /\s+/g,
    ' ',
  );

  // The Returned-to-Stock Review and Duplicate Review TABS were removed from the
  // Inventory UI (Owner request 2026-07-24). Their rules are still enforced at the
  // database + domain layer (the DB triggers asserted in the migration block below,
  // and the service.ts guarantees asserted above), so no honesty guarantee is lost
  // — the screen simply no longer surfaces those review workflows.
  it('no longer surfaces the removed RTS / Duplicate review tabs', () => {
    expect(view).not.toMatch(
      /never promotes a 2nd miner or allocates from the waitlist/i,
    );
    expect(view).not.toMatch(/Recording a judgement merges nothing/i);
  });

  it('shows forfeited items as excluded from auto-return', () => {
    expect(view).toMatch(/forfeited \(excluded from auto-return\)/i);
  });

  // The Migration TAB was removed from the Inventory UI (Owner request) — daily
  // users import via Upload Excel / CSV instead. The migration provenance rule is
  // still enforced at the database layer (asserted in the "Phase 8 migration"
  // block below), so no honesty guarantee is lost.
});

describe('Phase 8 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260715190000_phase8_inventory_rts_customers_migration.sql',
  );
  const sql = migration.replace(/^\s*--.*$/gm, '');

  it('gates the return to available behind an approved review', () => {
    expect(sql).toContain('enforce_return_to_available');
    expect(sql).toContain("r.status = 'approved_return'");
  });

  it('excludes a forfeited item from automatic return', () => {
    expect(sql).toMatch(/forfeited item is excluded from automatic stock return/i);
    expect(sql).toContain("l.status = 'forfeited'");
  });

  it('requires a decided review to record the freed-unit outcome', () => {
    expect(sql).toContain('enforce_rts_review_is_manual');
    expect(sql).toMatch(/must record what happened to the freed unit/i);
  });

  it('makes a rejected review hold the unit', () => {
    expect(sql).toMatch(/A rejected review holds the unit/i);
  });

  it('blocks automatic customer merge', () => {
    expect(sql).toContain('enforce_no_auto_customer_merge');
  });

  it('enforces migration provenance both ways', () => {
    // A migrated record carries its batch; a native record cannot claim one.
    expect(sql).toContain(
      "(source_kind = 'migrated') = (migration_batch_id is not null)",
    );
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

  it('records the unresolved RTS authority as provisional and merge as deferred', () => {
    expect(sql).toContain('provisional_fields');
    expect(migration).toContain('§19.26');
    expect(migration).toMatch(/DEFERRED post-V1/i);
  });
});
