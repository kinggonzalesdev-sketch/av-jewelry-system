import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderLabel, send } from '@/lib/labels/transport';

/**
 * Phase 4 guards — Confirm Claim & Print Label (Bible §22.3, §22.6, §22.7, §24).
 *
 * The invariants that matter here are structural (UNIQUE constraints, the
 * reservation guard, the atomic function) and are proven in the pgTAP suite,
 * which runs against a real database. These tests cover the parts that live in
 * TypeScript: label rendering, transport honesty, and the shape of the domain
 * modules.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');

const payload = {
  claimReference: 'CLM-2026-000001',
  customerDisplayName: 'Ana Reyes',
  itemCode: 'RG-21K-009',
  itemName: 'Ring 21K',
  gramsPerPiece: 5.5,
  quantity: 1,
  totalPrice: 12000,
  labelSize: '40x30mm',
};

describe('label rendering', () => {
  it('renders the approved 40x30mm geometry', () => {
    const content = renderLabel(payload);

    // 40 x 30 mm at 203 dpi.
    expect(content.widthDots).toBe(320);
    expect(content.heightDots).toBe(240);
  });

  it('includes the claim reference, customer, and item', () => {
    const lines = renderLabel(payload).lines.join('\n');

    expect(lines).toContain('CLM-2026-000001');
    expect(lines).toContain('Ana Reyes');
    expect(lines).toContain('RG-21K-009');
  });

  it('omits missing fields rather than printing empty rows', () => {
    const lines = renderLabel({
      ...payload,
      gramsPerPiece: null,
      totalPrice: null,
      quantity: null,
    }).lines;

    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    expect(lines.join('\n')).not.toContain('null');
  });

  it('is pure — rendering needs no device', () => {
    expect(renderLabel(payload)).toEqual(renderLabel(payload));
  });
});

describe('label transport honesty', () => {
  it('reports Bluetooth as unsupported, not failed', () => {
    // "failed" would invite a retry that can never succeed. The XP-236B
    // integration does not exist and must not pretend to (Bible §27).
    return send('bluetooth', renderLabel(payload)).then((outcome) => {
      expect(outcome.status).toBe('unsupported');
      expect(outcome.status === 'unsupported' && outcome.reason).toMatch(
        /not implemented and not verified/i,
      );
    });
  });

  it('never claims a verified Xprinter integration', () => {
    const transport = read('src', 'lib', 'labels', 'transport.ts');

    expect(transport).toMatch(/UNVERIFIED|not verified|not implemented/i);
    // No real Web Bluetooth / serial calls anywhere.
    expect(transport).not.toMatch(/navigator\.bluetooth/);
    expect(transport).not.toMatch(/requestDevice/);
  });

  it('records which transport produced an outcome', async () => {
    const mock = await send('mock', renderLabel(payload));
    const preview = await send('browser_preview', renderLabel(payload));

    expect(mock.transport).toBe('mock');
    expect(preview.transport).toBe('browser_preview');
  });

  it('fails a browser preview that rendered nothing', async () => {
    const outcome = await send('browser_preview', {
      widthDots: 320,
      heightDots: 240,
      lines: [],
    });

    expect(outcome.status).toBe('failed');
  });
});

describe('confirmation domain module', () => {
  const confirm = read('src', 'lib', 'claims', 'confirm.ts');

  it('checks the confirm permission before doing anything', () => {
    expect(confirm).toContain("requirePermission('confirm_claim_print_label')");
    // Compare against the RPC CALL, not the first textual mention — the
    // function is named in the doc comment above the permission check.
    expect(
      confirm.indexOf("requirePermission('confirm_claim_print_label')"),
    ).toBeLessThan(confirm.indexOf("rpc('confirm_claim_and_print'"));
  });

  it('performs the whole transition through one atomic function', () => {
    // Confirmed-claim-without-reservation is the partial state that must never
    // exist, so the claim update and the reservation cannot be separate calls.
    expect(confirm).toContain("rpc('confirm_claim_and_print'");
    expect(confirm).not.toContain("from('inventory_reservations')");
    expect(confirm).not.toMatch(/from\('claims'\)[\s\S]{0,80}\.update/);
  });

  it('creates no invoice and no Official Order', () => {
    expect(confirm).not.toContain('official_orders');
    expect(confirm).not.toContain('invoice_drafts');
  });

  it('never promotes a miner, allocates a waitlist, or returns stock', () => {
    expect(confirm).not.toContain('miner_positions');
    expect(confirm).not.toContain('waitlist_entries');
    expect(confirm).not.toMatch(/returned_to_available/);
  });

  it('audits a deduplicated retry as distinct from a real confirmation', () => {
    // Auditing a retry as a confirmation would make the trail assert the item
    // was reserved twice.
    expect(confirm).toContain("'claim.confirm.deduplicated'");
    expect(confirm).toContain('reservation_created: !result.deduplicated');
  });

  it('audits denial and failure, not only success', () => {
    expect(confirm).toContain("outcome: 'denied'");
    // The RPC-error path picks the outcome from the error code rather than
    // hardcoding it, so assert the branch exists.
    expect(confirm).toMatch(/outcome:\s*code === 'denied' \? 'denied' : 'failed'/);
  });

  it('distinguishes a refusal from a conflict from a stock shortage', () => {
    expect(confirm).toContain("'denied'");
    expect(confirm).toContain("'no_stock'");
    expect(confirm).toContain("'invalid_state'");
  });
});

describe('label job module', () => {
  const jobs = read('src', 'lib', 'labels', 'jobs.ts');

  it('separates retry from reprint by permission and intent', () => {
    expect(jobs).toContain('export async function retryPrint');
    expect(jobs).toContain('export async function reprintLabel');
    expect(jobs).toContain("requirePermission('retry_reprint_label')");
  });

  it('requires a reason for a reprint', () => {
    expect(jobs).toMatch(/A reprint requires a reason/);
  });

  it('refuses to retry a job that already printed — that is a reprint', () => {
    expect(jobs).toMatch(/Use Reprint with a reason instead/);
  });

  it('gates Void/Cancel behind its own permission and requires a reason', () => {
    expect(jobs).toContain("requirePermission('void_cancel_label_job')");
    expect(jobs).toMatch(/Voiding a label job requires a reason/);
  });

  it('never creates a claim, reservation, or order from any print path', () => {
    expect(jobs).not.toContain("from('claims').insert");
    expect(jobs).not.toContain('inventory_reservations');
    expect(jobs).not.toContain('official_orders');
  });

  it('never rolls back a confirmed claim when printing fails', () => {
    // A paper jam does not un-sell a ring. Nothing on the print path may
    // update a claim's status.
    expect(jobs).not.toMatch(/status:\s*'pending_claim'/);
    expect(jobs).not.toMatch(/from\('claims'\)[\s\S]{0,120}\.update/);
  });

  it('does not record an unsupported transport as a failed print attempt', () => {
    const unsupportedBlock = jobs.slice(jobs.indexOf("outcome.status === 'unsupported'"));
    expect(unsupportedBlock).toContain('label_job.print.unsupported');
  });
});

describe('Claim Review module', () => {
  const review = read('src', 'lib', 'claims', 'review.ts');

  it('reads only — review decides nothing', () => {
    expect(review).not.toContain('.insert(');
    expect(review).not.toContain('.update(');
    expect(review).not.toContain('.delete(');
  });

  it('offers no automatic approval', () => {
    const codeOnly = review.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(codeOnly).not.toMatch(/auto.?approve/i);
    expect(codeOnly).not.toMatch(/approveAll/i);
  });

  it('surfaces the information confirmation depends on', () => {
    for (const field of [
      'claimReference',
      'captureMethod',
      'liveBatchReference',
      'customerFacebookName',
      'itemCode',
      'gramsPerPiece',
      'totalPricePerPiece',
      'capturedByName',
      'capturedAt',
      'capturedAgainstFlexItem',
      'minerPosition',
      'waitlistStatus',
      'availableQuantity',
      'reservationImpact',
      'warnings',
    ]) {
      expect(review).toContain(field);
    }
  });

  it('derives availability from the single source of truth', () => {
    // A second implementation of "available" could drift, and drift here means
    // double-selling.
    expect(review).toContain('available_quantity_for');
  });

  it('warns rather than blocks — authority is checked server-side', () => {
    expect(review).toContain("severity: 'blocking'");
    expect(review).toContain("severity: 'advisory'");
  });
});

describe('Phase 4 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260715150000_phase4_confirm_claim_print_label.sql',
  );

  it('keeps the confirmation function security invoker so RLS still applies', () => {
    expect(migration).toContain('security invoker');
    expect(migration).not.toMatch(/confirm_claim_and_print[\s\S]{0,400}security definer/);
  });

  it('checks permission inside the transaction', () => {
    expect(migration).toContain(
      "app_private.has_permission('confirm_claim_print_label')",
    );
  });

  it('locks the claim row so concurrent confirmations yield one reservation', () => {
    expect(migration).toContain('for update');
  });

  it('is idempotent by claim', () => {
    expect(migration).toContain("'deduplicated', true");
  });

  it('revokes execute from anon', () => {
    expect(migration).toContain('revoke all on function public.confirm_claim_and_print');
  });

  it('records the unresolved hardware and label policies as provisional', () => {
    expect(migration).toContain('provisional_fields');
    expect(migration).toContain('§24.17');
    expect(migration).toContain('§6.22');
  });

  it('never weakens the Phase 3 pending-only trigger', () => {
    expect(migration).not.toMatch(
      /drop\s+trigger[\s\S]{0,60}capture_creates_pending_only/i,
    );
    expect(migration).not.toMatch(/enforce_capture_creates_pending_only/);
  });
});
