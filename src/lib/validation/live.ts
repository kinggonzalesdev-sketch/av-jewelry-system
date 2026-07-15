import { z } from 'zod';

/**
 * Phase 3 validation — Live Selling & Claim Intake (Bible §12, §13).
 *
 * Server-side validation. The UI may validate too, for a better message, but the
 * UI is never the control: every schema here runs again inside the server action
 * before any write (ADR §7).
 *
 * ⚠️  PROVISIONAL (Bible §12.74, roadmap Phase 3 open item): the exact
 *     Live-Batch / source-marker / manual-entry field set is NOT client-final.
 *     The roadmap permits starting from a proposed set. These schemas encode
 *     that proposed set and are expected to change before pilot. The provisional
 *     columns are also recorded in app_private.provisional_fields.
 */

const uuid = z.string().uuid('A valid record reference is required');

/** Trimmed, non-empty text with a hard ceiling. */
const text = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(min, `${label} is required`)
        .max(max, `${label} must be ${max} characters or fewer`),
    );

// ---------------------------------------------------------------------------
// Live Batch lifecycle (Bible §12, §22.4)
// ---------------------------------------------------------------------------

/**
 * The approved Live Batch lifecycle. Reopen is absent on purpose: it is not a
 * staff transition at all, it is an Owner approval (§5.13, §22.4).
 */
export const LIVE_BATCH_TRANSITIONS = {
  open: 'active',
  pause: 'paused',
  resume: 'active',
  end: 'live_ended',
  close: 'closed',
} as const;

export type LiveBatchTransition = keyof typeof LIVE_BATCH_TRANSITIONS;

/**
 * Which transitions are legal FROM each status.
 *
 * Encoded as data rather than if-chains so an invalid state transition is a
 * lookup failure, not a forgotten branch. 'closed' maps to nothing: a closed
 * batch is terminal for staff, and reopening requires Owner approval.
 */
export const LIVE_BATCH_ALLOWED_TRANSITIONS: Record<string, LiveBatchTransition[]> = {
  draft: ['open'],
  active: ['pause', 'end'],
  paused: ['resume', 'end'],
  live_ended: ['close'],
  closed: [],
  reopened: ['pause', 'end'],
};

export const createLiveBatchSchema = z.object({
  // PROVISIONAL (§12.74): the minimal proposed Live Batch field set.
  title: text(1, 160, 'Live Batch title'),
  scopeId: uuid.nullable().optional(),
});
export type CreateLiveBatchInput = z.infer<typeof createLiveBatchSchema>;

export const liveBatchTransitionSchema = z.object({
  liveBatchId: uuid,
  transition: z.enum(['open', 'pause', 'resume', 'end', 'close']),
});
export type LiveBatchTransitionInput = z.infer<typeof liveBatchTransitionSchema>;

// ---------------------------------------------------------------------------
// Current Flex Item (Bible §12)
// ---------------------------------------------------------------------------

export const setCurrentFlexItemSchema = z.object({
  liveBatchId: uuid,
  // null clears the Current Flex Item without selecting another.
  liveBatchItemId: uuid.nullable(),
});
export type SetCurrentFlexItemInput = z.infer<typeof setCurrentFlexItemSchema>;

// ---------------------------------------------------------------------------
// Claim capture (Bible §13)
// ---------------------------------------------------------------------------

/** Source markers (§13.2). 'migrated' is absent: migration is not capture. */
export const CAPTURE_METHODS = [
  'manual_live',
  'screenshot_upload',
  'ios_share',
  'post_live_manual',
] as const;

export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/**
 * Evidence attached at capture.
 *
 * Stored, never interpreted. There is deliberately no field for "extracted" or
 * "parsed" values: §13.2 prohibits OCR / auto-read. A human reads the screenshot
 * and types the customer and quantity.
 */
export const claimEvidenceSchema = z.object({
  evidenceKind: z.enum(['screenshot', 'ios_share', 'manual_note']),
  storagePath: z.string().trim().min(1).max(400).nullable().optional(),
  contentType: z.string().trim().max(120).nullable().optional(),
  byteSize: z.number().int().nonnegative().nullable().optional(),
  sharedText: z.string().max(4000).nullable().optional(),
});
export type ClaimEvidenceInput = z.infer<typeof claimEvidenceSchema>;

/**
 * Capturing a Pending Claim.
 *
 * Note what is NOT here, deliberately (§12.3, §13.2):
 *   - no `status`      — capture creates a Pending Claim only; the caller cannot choose
 *   - no `confirm`     — confirmation is Phase 4 and a different permission
 *   - no `reserve`     — a Pending Claim holds no reservation
 *   - no `customerId` inference — no auto-match; the capturer names the customer
 *
 * `idempotencyKey` is required, not optional: a capture endpoint without one is
 * a duplicate-claim generator the first time a phone retries on a flaky Live.
 */
export const captureClaimSchema = z
  .object({
    idempotencyKey: text(8, 200, 'Idempotency key'),
    captureMethod: z.enum(CAPTURE_METHODS),

    liveBatchId: uuid.nullable().optional(),
    liveBatchItemId: uuid.nullable().optional(),
    inventoryItemId: uuid,
    customerId: uuid,

    quantity: z
      .number()
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1'),

    evidence: z.array(claimEvidenceSchema).max(10).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const isLive = value.captureMethod !== 'post_live_manual';

    // A live capture belongs to a Live Batch; post-live entry must not pretend to.
    if (isLive && !value.liveBatchId) {
      ctx.addIssue({
        code: 'custom',
        path: ['liveBatchId'],
        message: 'A live capture must belong to a Live Batch.',
      });
    }

    if (!isLive && value.liveBatchId) {
      ctx.addIssue({
        code: 'custom',
        path: ['liveBatchId'],
        message:
          'Manual Post-Live Entry does not belong to a Live Batch. Capture it during the Live instead.',
      });
    }

    // A screenshot capture without the screenshot is just a manual entry
    // mislabelled — the source marker would be a lie.
    if (value.captureMethod === 'screenshot_upload') {
      const hasScreenshot = value.evidence?.some((e) => e.evidenceKind === 'screenshot');
      if (!hasScreenshot) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'A screenshot capture must attach the screenshot.',
        });
      }
    }

    if (value.captureMethod === 'ios_share') {
      const hasShare = value.evidence?.some((e) => e.evidenceKind === 'ios_share');
      if (!hasShare) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'An iOS Share capture must carry the shared payload.',
        });
      }
    }
  });

export type CaptureClaimInput = z.infer<typeof captureClaimSchema>;

/**
 * Post-Live Item Entry (§12): creating an item after the Live has ended.
 * A separate permission from capture — entering an item is not claiming it.
 */
export const postLiveItemEntrySchema = z
  .object({
    // The approved New Entry screen makes Item Name the required main field and
    // Item Code an optional detail, so the schema matches that, not the reverse.
    itemName: text(1, 160, 'Item name'),
    itemCode: text(1, 80, 'Item code').optional(),
    isUniqueItem: z.boolean().default(true),
    quantityTotal: z.number().int().min(1, 'Quantity must be at least 1').default(1),
    gramsPerPiece: z.number().positive().nullable().optional(),
    totalPricePerPiece: z.number().nonnegative().nullable().optional(),
    liveBatchId: uuid.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // A unique item is quantity-one by definition (§19.7). Caught here so the
    // user gets a sentence instead of a database constraint name.
    if (value.isUniqueItem && value.quantityTotal !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantityTotal'],
        message:
          'A unique item is quantity-one. Uncheck "unique" to stock more than one.',
      });
    }
  });
export type PostLiveItemEntryInput = z.infer<typeof postLiveItemEntrySchema>;
