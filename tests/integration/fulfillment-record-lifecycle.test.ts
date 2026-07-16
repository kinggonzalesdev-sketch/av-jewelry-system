import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The fulfillment record lifecycle, at the layers SQL cannot assert.
 *
 * THE DEFECT. Nothing created a fulfillment_records row, and prepareFulfillment()
 * UPDATEd by official_order_id without asking what it touched. An UPDATE matching
 * ZERO rows returns no error in PostgREST, so Prepare reported success and
 * changed nothing. The operator pressed the button, read "Prepared", and moved
 * on. A silent no-op is worse than a visible failure: it ends the investigation.
 *
 * The database side (atomicity, idempotency, initial state, backfill) is proved
 * in supabase/tests/20_fulfillment_record_lifecycle.test.sql, executed as a real
 * Staff JWT. What lives here is the TypeScript contract that turns a zero-row
 * update into an explicit failure.
 */

const projectRoot = join(__dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(join(projectRoot, relative), 'utf8');
}

/** Comments removed. Assertions read code, never the prose explaining it. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const service = read('src/lib/fulfillment/service.ts');

function bodyOf(fnName: string): string {
  const start = service.indexOf(`export async function ${fnName}`);
  expect(start, `${fnName} must exist`).toBeGreaterThan(-1);
  const next = service.indexOf('\nexport async function', start + 10);
  return service.slice(start, next === -1 ? undefined : next);
}

describe('prepareFulfillment cannot report success against zero rows', () => {
  const prepare = bodyOf('prepareFulfillment');

  it('asks the database what it actually touched', () => {
    // Without .select(), a zero-row UPDATE is indistinguishable from a
    // successful one — which is exactly how this shipped.
    expect(prepare).toMatch(
      /\.eq\('official_order_id', officialOrderId\)\s*\n?\s*\.select\(/,
    );
  });

  it('returns an explicit failure when no record matched', () => {
    expect(prepare).toMatch(/if \(!data \|\| data\.length === 0\)/);
    expect(prepare).toMatch(/Fulfillment record missing for Official Order/);
    expect(prepare).toMatch(/Preparation was not saved/);
  });

  it('audits the failed preparation instead of swallowing it', () => {
    const zeroRowBranch = prepare.slice(prepare.indexOf('data.length === 0'));
    expect(zeroRowBranch).toMatch(/recordAuditEvent/);
    expect(zeroRowBranch).toMatch(/outcome: 'failed'/);
  });

  it('does NOT create the missing record as a silent fallback', () => {
    // A missing row after migration 20260716230000 is a data-integrity fact.
    // Manufacturing one here would paper over it and make the cause unfindable.
    const zeroRowBranch = code('src/lib/fulfillment/service.ts');
    const prepareCode = zeroRowBranch.slice(
      zeroRowBranch.indexOf('export async function prepareFulfillment'),
      zeroRowBranch.indexOf('export async function releaseFulfillment'),
    );
    expect(prepareCode).not.toMatch(/\.insert\(/);
    expect(prepareCode).not.toMatch(/upsert/);
  });

  it('still cannot release, dispatch, or complete', () => {
    const prepareCode = code('src/lib/fulfillment/service.ts');
    const body = prepareCode.slice(
      prepareCode.indexOf('export async function prepareFulfillment'),
      prepareCode.indexOf('export async function releaseFulfillment'),
    );
    expect(body).not.toMatch(/approved_for_release|dispatched|picked_up|completed/);
    expect(body).not.toMatch(/released_at|released_by/);
  });

  it('sets only the preparation queue status', () => {
    expect(prepare).toMatch(
      /status: input\.method === 'shipping' \? 'for_shipping' : 'for_pickup'/,
    );
  });
});

describe('the fulfillment record is created by the atomic transaction', () => {
  const migration = read(
    'supabase/migrations/20260716230000_fulfillment_record_lifecycle.sql',
  );

  it('inserts the record inside approve_and_send_invoice, not from the client', () => {
    expect(migration).toMatch(
      /create or replace function public\.approve_and_send_invoice/,
    );
    // Via the app_private helper: the fulfillment_insert policy governs
    // user-initiated inserts under fulfillment_preparation, and the caller here
    // holds invoice_preparation. Two acts, two authorities.
    expect(migration).toMatch(
      /perform app_private\.create_fulfillment_tracking\(v_order\.id\)/,
    );
  });

  it('the helper is narrow: definer, pinned search_path, re-authorized, no anon', () => {
    const helper = migration.slice(
      migration.indexOf(
        'create or replace function app_private.create_fulfillment_tracking',
      ),
      migration.indexOf('comment on function app_private.create_fulfillment_tracking'),
    );
    expect(helper).toMatch(/security definer/);
    expect(helper).toMatch(/set search_path = ''/);
    // Reachability is not authorization: the definer re-checks for itself.
    expect(helper).toMatch(/has_permission\('invoice_preparation'\)/);
    expect(migration).toMatch(
      /revoke all on function app_private\.create_fulfillment_tracking\(uuid\) from public, anon/,
    );
  });

  it('does NOT widen the fulfillment_insert policy', () => {
    // Folding invoice_preparation into fulfillment authority would make one
    // permission silently imply another (§5.13). The policy is untouched.
    expect(migration).not.toMatch(/create policy fulfillment_insert/);
    expect(migration).not.toMatch(/alter policy fulfillment_insert/);
  });

  it('no TypeScript creates a fulfillment record', () => {
    // A best-effort second request from the client could leave an Official Order
    // without tracking — the exact partial state the transaction prevents.
    const libFiles = [
      'src/lib/fulfillment/service.ts',
      'src/lib/invoicing/approve.ts',
      'src/lib/invoicing/actions.ts',
    ];
    for (const file of libFiles) {
      const text = code(file);
      expect(text).not.toMatch(/from\('fulfillment_records'\)\s*\.insert/);
    }
  });

  /** The helper's INSERT statement, comments stripped. */
  function helperInsert(): string {
    const stripped = migration
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '');
    const at = stripped.indexOf(
      'insert into public.fulfillment_records (official_order_id, status)',
    );
    expect(at).toBeGreaterThan(-1);
    return stripped.slice(at, stripped.indexOf(';', at) + 1);
  }

  it('creates it with lifecycle-safe defaults only', () => {
    const insert = helperInsert();
    // Only the order id and the queue status. Every other column keeps its
    // schema default — anything else would be the system claiming work nobody
    // has done.
    expect(insert).toMatch(/'for_preparation'/);
    expect(insert).not.toMatch(/courier|tracking_number|released_at|prepared_at/);
    expect(insert).not.toMatch(/\bmethod\b/);
  });

  it('does not swallow a duplicate with on-conflict', () => {
    // The UNIQUE constraint should be allowed to speak; swallowing it would hide
    // a real invariant violation.
    expect(helperInsert()).not.toMatch(/on conflict/i);
  });
});

describe('the backfill repairs history without inventing it', () => {
  const migration = read(
    'supabase/migrations/20260716230000_fulfillment_record_lifecycle.sql',
  );

  it('is idempotent by construction', () => {
    expect(migration).toMatch(
      /where not exists \(\s*\n?\s*select 1 from public\.fulfillment_records/,
    );
  });

  it('backfills only the queue status — no courier, tracking, or release', () => {
    const backfill = migration.slice(
      migration.indexOf(
        'insert into public.fulfillment_records (official_order_id, status)\nselect o.id',
      ),
      migration.indexOf('-- The backfill is auditable'),
    );
    expect(backfill).toMatch(/'for_preparation'/);
    expect(backfill).not.toMatch(/courier|tracking_number|released_at|dispatched/);
  });

  it('records the backfill as a SYSTEM action, not a staff one', () => {
    // Putting a person's name against a migration would be a false attribution.
    expect(migration).toMatch(/'system'/);
    expect(migration).toMatch(/fulfillment\.backfill/);
    expect(migration).toMatch(/fabricated_courier_or_tracking'?, false/);
  });

  it('fails loudly if any order is left without a record', () => {
    expect(migration).toMatch(/Backfill incomplete/);
    expect(migration).toMatch(/raise exception/);
  });
});
