import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAPTURE_METHODS,
  LIVE_BATCH_ALLOWED_TRANSITIONS,
  LIVE_BATCH_TRANSITIONS,
  captureClaimSchema,
  createLiveBatchSchema,
  postLiveItemEntrySchema,
  setCurrentFlexItemSchema,
} from '@/lib/validation/live';

/**
 * Phase 3 guards — Live Selling & Claim Intake (Bible §12, §13).
 *
 * These lock the invariants that make the phase safe: capture creates a Pending
 * Claim only, a retry cannot become a second claim, and evidence is never read.
 */

const projectRoot = join(__dirname, '..', '..');

// Real RFC 4122 v4 UUIDs (version nibble 4, variant nibble 8-b). Repeated-digit
// placeholders like '1111...' are NOT valid v4 and the schema rightly rejects
// them — Postgres gen_random_uuid() always produces conformant values.
const ITEM = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';
const BATCH = '33333333-3333-4333-8333-333333333333';
const BATCH_ITEM = '44444444-4444-4444-8444-444444444444';

const validLiveCapture = {
  idempotencyKey: 'capture-key-00000001',
  captureMethod: 'manual_live' as const,
  liveBatchId: BATCH,
  liveBatchItemId: BATCH_ITEM,
  inventoryItemId: ITEM,
  customerId: CUSTOMER,
  quantity: 1,
};

describe('claim capture validation', () => {
  it('accepts a well-formed live capture', () => {
    expect(captureClaimSchema.safeParse(validLiveCapture).success).toBe(true);
  });

  it('requires an idempotency key — a capture endpoint without one duplicates claims', () => {
    const { idempotencyKey: _omitted, ...withoutKey } = validLiveCapture;
    expect(captureClaimSchema.safeParse(withoutKey).success).toBe(false);
  });

  it('rejects a trivially short idempotency key', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      idempotencyKey: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('offers no way to set a status — capture creates a Pending Claim only', () => {
    // A caller cannot smuggle a confirmed claim through the capture path: the
    // schema strips unknown keys, so `status` never reaches the insert.
    const parsed = captureClaimSchema.parse({
      ...validLiveCapture,
      status: 'confirmed_claim',
    });

    expect(parsed).not.toHaveProperty('status');
  });

  it('offers no reservation or confirmation field', () => {
    const parsed = captureClaimSchema.parse(validLiveCapture);

    expect(parsed).not.toHaveProperty('reserve');
    expect(parsed).not.toHaveProperty('confirm');
    expect(parsed).not.toHaveProperty('reservationId');
  });

  it('does not accept extracted or auto-read values — no OCR', () => {
    const parsed = captureClaimSchema.parse({
      ...validLiveCapture,
      extractedCustomerName: 'Read from screenshot',
      ocrText: 'MINE',
    });

    expect(parsed).not.toHaveProperty('extractedCustomerName');
    expect(parsed).not.toHaveProperty('ocrText');
  });

  it('requires a Live Batch for a live capture', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      liveBatchId: undefined,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a post-live entry that claims a Live Batch', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      captureMethod: 'post_live_manual',
    });

    expect(result.success).toBe(false);
  });

  it('accepts Manual Post-Live Entry without a Live Batch', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      captureMethod: 'post_live_manual',
      liveBatchId: undefined,
      liveBatchItemId: undefined,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a screenshot capture with no screenshot attached', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      captureMethod: 'screenshot_upload',
      evidence: [{ evidenceKind: 'manual_note', sharedText: 'typed instead' }],
    });

    expect(result.success).toBe(false);
  });

  it('accepts a screenshot capture that attaches the screenshot', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      captureMethod: 'screenshot_upload',
      evidence: [{ evidenceKind: 'screenshot', storagePath: 'private/claims/a.jpg' }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an iOS Share capture carrying no shared payload', () => {
    const result = captureClaimSchema.safeParse({
      ...validLiveCapture,
      captureMethod: 'ios_share',
      evidence: [{ evidenceKind: 'manual_note', sharedText: 'note' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a quantity below one', () => {
    expect(
      captureClaimSchema.safeParse({ ...validLiveCapture, quantity: 0 }).success,
    ).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(
      captureClaimSchema.safeParse({ ...validLiveCapture, quantity: 1.5 }).success,
    ).toBe(false);
  });

  it('lists only capture source markers — migration is not capture', () => {
    expect(CAPTURE_METHODS).toEqual([
      'manual_live',
      'screenshot_upload',
      'ios_share',
      'post_live_manual',
    ]);
    expect(CAPTURE_METHODS).not.toContain('migrated');
  });
});

describe('Live Batch lifecycle', () => {
  it('maps each transition to its resulting status', () => {
    expect(LIVE_BATCH_TRANSITIONS).toEqual({
      open: 'active',
      pause: 'paused',
      resume: 'active',
      end: 'live_ended',
      close: 'closed',
    });
  });

  it('treats a closed batch as terminal for staff — reopen is Owner-approved', () => {
    expect(LIVE_BATCH_ALLOWED_TRANSITIONS.closed).toEqual([]);
  });

  it('offers no staff reopen transition anywhere', () => {
    const every = Object.values(LIVE_BATCH_ALLOWED_TRANSITIONS).flat();
    expect(every).not.toContain('reopen');
  });

  it('rejects invalid state transitions', () => {
    // A draft batch cannot be closed without ever running.
    expect(LIVE_BATCH_ALLOWED_TRANSITIONS.draft).not.toContain('close');
    // An ended Live cannot be paused.
    expect(LIVE_BATCH_ALLOWED_TRANSITIONS.live_ended).not.toContain('pause');
    // A draft batch cannot be paused before it opens.
    expect(LIVE_BATCH_ALLOWED_TRANSITIONS.draft).not.toContain('pause');
  });

  it('requires a title', () => {
    expect(createLiveBatchSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createLiveBatchSchema.safeParse({ title: 'Friday Live' }).success).toBe(true);
  });
});

describe('Current Flex Item', () => {
  it('allows clearing without selecting another', () => {
    const result = setCurrentFlexItemSchema.safeParse({
      liveBatchId: BATCH,
      liveBatchItemId: null,
    });

    expect(result.success).toBe(true);
  });

  it('requires a real batch reference', () => {
    expect(
      setCurrentFlexItemSchema.safeParse({ liveBatchId: 'nope', liveBatchItemId: null })
        .success,
    ).toBe(false);
  });
});

describe('Post-Live Item Entry', () => {
  it('requires an item name, matching the approved New Entry screen', () => {
    expect(postLiveItemEntrySchema.safeParse({ itemName: '' }).success).toBe(false);
    expect(postLiveItemEntrySchema.safeParse({ itemName: 'Ring 18K' }).success).toBe(
      true,
    );
  });

  it('defaults to a unique, quantity-one item', () => {
    const parsed = postLiveItemEntrySchema.parse({ itemName: 'Ring 18K' });

    expect(parsed.isUniqueItem).toBe(true);
    expect(parsed.quantityTotal).toBe(1);
  });

  it('rejects a unique item with quantity above one', () => {
    const result = postLiveItemEntrySchema.safeParse({
      itemName: 'Ring 18K',
      isUniqueItem: true,
      quantityTotal: 3,
    });

    expect(result.success).toBe(false);
  });

  it('allows a multi-stock item to hold more than one', () => {
    const result = postLiveItemEntrySchema.safeParse({
      itemName: 'Gold chain',
      isUniqueItem: false,
      quantityTotal: 3,
    });

    expect(result.success).toBe(true);
  });
});

describe('Phase 3 capture module invariants', () => {
  const capture = readFileSync(
    join(projectRoot, 'src', 'lib', 'claims', 'capture.ts'),
    'utf8',
  );

  /**
   * The captureClaim function alone. Scoped deliberately: createPostLiveItem
   * legitimately writes quantity_total (it CREATES an item). The invariant is
   * that CAPTURE never touches stock — not that the file never mentions it.
   */
  const captureFn = capture.slice(
    capture.indexOf('export async function captureClaim'),
    capture.indexOf('async function attachEvidence'),
  );

  it('always inserts a pending claim and never another status', () => {
    expect(capture).toContain("status: 'pending_claim'");
    expect(capture).not.toMatch(/status:\s*data\./);
    expect(capture).not.toMatch(/status:\s*input\./);
  });

  it('never writes a reservation on the capture path', () => {
    expect(capture).not.toContain('inventory_reservations');
  });

  it('never touches inventory stock or availability on the capture path', () => {
    expect(captureFn).not.toMatch(/quantity_total/);
    expect(captureFn).not.toMatch(/availability_status/);
    expect(captureFn).not.toContain("from('inventory_items')");
  });

  it('checks the claim_capture permission before writing', () => {
    expect(capture).toContain("requirePermission('claim_capture')");
    expect(capture.indexOf("requirePermission('claim_capture')")).toBeLessThan(
      capture.indexOf(".from('claims')"),
    );
  });

  it('requires a distinct permission for Post-Live Item Entry', () => {
    expect(capture).toContain("requirePermission('post_live_item_entry')");
  });

  it('records an audit event for capture, denial, and failure', () => {
    expect(capture).toContain("action: 'claim.capture'");
    expect(capture).toContain("outcome: 'denied'");
    expect(capture).toContain("outcome: 'failed'");
  });

  it('handles the concurrent double-submit by returning the winning claim', () => {
    // 23505 is the unique violation on idempotency_key. It must resolve to the
    // existing claim, never to a second insert.
    expect(capture).toContain("error?.code === '23505'");
    expect(capture).toContain('deduplicated: true');
  });
});

describe('Phase 3 live batch module invariants', () => {
  const batches = readFileSync(
    join(projectRoot, 'src', 'lib', 'live', 'batches.ts'),
    'utf8',
  );

  it('separates Closure from Operation permissions', () => {
    expect(batches).toContain("'live_batch_closure'");
    expect(batches).toContain("'live_batch_operation'");
  });

  it('exposes no reopen path — reopen is a non-delegable Owner approval', () => {
    // Naming reopen in a refusal message ("Reopening requires Owner approval")
    // is correct and must survive. What must not exist is an ACTION that does it.
    expect(batches).not.toMatch(/export\s+async\s+function\s+reopen/i);
    expect(batches).not.toMatch(/status:\s*'reopened'/);
    expect(batches).not.toMatch(/reopened_approval_request_id/);
  });

  it('never touches claims, inventory, invoices, or orders when closing', () => {
    // Bible §12.57: closing a batch changes the batch and nothing else.
    expect(batches).not.toContain("from('claims')");
    expect(batches).not.toContain("from('inventory_items')");
    expect(batches).not.toContain("from('inventory_reservations')");
    expect(batches).not.toContain("from('official_orders')");
  });

  it('revalidates the stored status rather than trusting the caller', () => {
    expect(batches).toContain(".eq('status', current)");
  });
});
