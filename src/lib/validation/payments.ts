import { z } from 'zod';

import { ACCEPTED_PAYMENT_METHODS, isCashMethod } from '@/lib/payments/methods';

/**
 * Phase 6 validation — Payment & Layaway (Bible §16, §17).
 * Encodes docs/PHASE-6-APPROVED-DECISIONS.md §3, §5, §6.
 *
 * ⚠️  CARD DATA IS NEVER ACCEPTED. There is deliberately no field for a card
 *     number, CVV, PIN, or any authentication data (§3). `provider` holds the
 *     CHANNEL and `referenceNumber` the approval reference — that is the entire
 *     permitted card footprint, and Zod strips anything else a caller sends.
 */

const uuid = z.string().uuid('A valid record reference is required');

/**
 * Money as a decimal STRING, never a JS number.
 *
 * `number` is a float: 0.1 + 0.2 !== 0.3. A peso amount that round-trips through
 * a float can arrive a centavo short, and this system decides whether a customer
 * still owes money. Postgres numeric is exact; the string preserves it.
 */
export const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.50')
  .refine((v) => Number(v) > 0, 'The amount must be greater than zero');

/**
 * The methods the data layer accepts: the five canonical Mode-of-Payment values
 * (Cash / GCash / BPI / BDO / Credit Card) plus the legacy machine keys retained
 * so historical records still validate. The single source of truth lives in
 * `@/lib/payments/methods`.
 */
export const PAYMENT_METHODS = ACCEPTED_PAYMENT_METHODS;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentEvidenceSchema = z.object({
  storagePath: z.string().trim().min(1).max(400),
  contentType: z.string().trim().max(120).nullable().optional(),
  byteSize: z.number().int().nonnegative().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

/**
 * Recording a payment (approved decision §3).
 *
 * Note what is absent, deliberately:
 *   - no `status`         — every payment is born unverified; the caller cannot choose
 *   - no `verifiedAmount` — recording is not verifying
 *   - no card number / CVV / PIN — never accepted, never stored
 *
 * Per-method required evidence is enforced in `superRefine` below, and the
 * database re-checks the cash rule independently.
 */
export const recordPaymentSchema = z
  .object({
    officialOrderId: uuid,
    amount: money,
    paymentMethod: z.enum(PAYMENT_METHODS),

    referenceNumber: z.string().trim().min(1).max(120).nullable().optional(),
    provider: z.string().trim().min(1).max(160).nullable().optional(),
    transactedAt: z.string().min(1, 'The transaction date and time are required'),
    collectionLocation: z.string().trim().max(160).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),

    evidence: z.array(paymentEvidenceSchema).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    // Every method carries a transaction/reference number — the audit trail for the
    // money. (Cash defaults one server-side, but the operator may still type theirs.)
    if (!value.referenceNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceNumber'],
        message: 'A transaction/reference number is required for this payment method.',
      });
    }

    // Cash (canonical "Cash" or legacy "cash") names WHERE it was collected. The
    // channel for GCash / BPI / BDO / Credit Card is the method itself, so no
    // separate provider field is required. Evidence stays optional (Owner request
    // 2026-07-22). Historical "other" records still require a note.
    if (isCashMethod(value.paymentMethod) && !value.collectionLocation) {
      ctx.addIssue({
        code: 'custom',
        path: ['collectionLocation'],
        message: 'The store or collection location is required for cash.',
      });
    }

    if (value.paymentMethod === 'other' && !value.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'An "other" payment method requires a reason or note.',
      });
    }
  });

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/**
 * Verifying a payment (approved decision §4).
 * `verifiedAmount` is what ACTUALLY arrived — only it reduces the balance.
 */
export const verifyPaymentSchema = z
  .object({
    paymentId: uuid,
    outcome: z.enum(['verified', 'rejected']),
    verifiedAmount: money.nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === 'verified' && !value.verifiedAmount) {
      ctx.addIssue({
        code: 'custom',
        path: ['verifiedAmount'],
        message: 'Verifying a payment requires the amount that actually arrived.',
      });
    }

    if (value.outcome === 'rejected' && !value.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Rejecting evidence requires a reason.',
      });
    }
  });

// ---------------------------------------------------------------------------
// Layaway (approved decisions §5, §6)
// ---------------------------------------------------------------------------

/** Minimum 1 month, maximum 3 (§5). */
export const LAYAWAY_MIN_MONTHS = 1;
export const LAYAWAY_MAX_MONTHS = 3;
/** Maximum 10 calendar days after the final due date (§6). */
export const LAYAWAY_MAX_GRACE_DAYS = 10;
/** 20% of the Layaway Amount Payable, fee included (§6). */
export const LAYAWAY_DEPOSIT_PERCENT = 20;
/** PHP 150 per gram per month (§5). */
export const LAYAWAY_FEE_PER_GRAM_MONTH = '150';

export const activateLayawaySchema = z.object({
  officialOrderId: uuid,
  months: z
    .number()
    .int()
    .min(LAYAWAY_MIN_MONTHS, 'The minimum Layaway term is 1 month')
    .max(LAYAWAY_MAX_MONTHS, 'The maximum Layaway term is 3 months'),
  depositPaymentId: uuid,
  finalDueDate: z.string().min(1, 'The final due date is required'),
  /** Chosen reusable code (A1–Z200). Optional: omitted means auto-assign. */
  layawayCode: z
    .string()
    .regex(/^[A-Z]([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$/, 'Choose a valid layaway code')
    .nullable()
    .optional(),
});

export type ActivateLayawayInput = z.infer<typeof activateLayawaySchema>;

/**
 * Recording an installment (Bible §17).
 *
 * Recording an installment is NOT verifying it — the payment it references
 * still has to be verified separately, which is why there is no outcome field.
 */
export const recordInstallmentSchema = z.object({
  layawayArrangementId: uuid,
  installmentNumber: z.number().int().min(1),
  amountDue: money,
  dueDate: z.string().min(1, 'The due date is required'),
  paymentId: uuid.nullable().optional(),
});

export type RecordInstallmentInput = z.infer<typeof recordInstallmentSchema>;
