import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatPeso } from '@/lib/payments/format';
import {
  LAYAWAY_DEPOSIT_PERCENT,
  LAYAWAY_MAX_GRACE_DAYS,
  LAYAWAY_MAX_MONTHS,
  LAYAWAY_MIN_MONTHS,
  PAYMENT_METHODS,
  activateLayawaySchema,
  money,
  recordPaymentSchema,
  verifyPaymentSchema,
} from '@/lib/validation/payments';

/**
 * Phase 6 guards — Payment & Layaway (Bible §16, §17).
 *
 * The approved money formulas live in SQL and are proven against a real database
 * in the pgTAP suite (exact decimal, half-up, worked examples). These cover the
 * TypeScript surface: input validation, money-as-string, and the shape of the
 * domain modules.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ORDER = '11111111-1111-4111-8111-111111111111';

const validBankTransfer = {
  officialOrderId: ORDER,
  amount: '2150.00',
  paymentMethod: 'bank_transfer' as const,
  referenceNumber: 'BT-0001',
  provider: 'BDO',
  transactedAt: '2026-07-15T10:00:00Z',
  evidence: [{ storagePath: 'private/payments/proof.jpg' }],
};

describe('money is exact decimal, never float', () => {
  it('accepts a peso amount as a string', () => {
    expect(money.safeParse('1500').success).toBe(true);
    expect(money.safeParse('1500.50').success).toBe(true);
  });

  it('rejects more than two decimal places', () => {
    expect(money.safeParse('1500.505').success).toBe(false);
  });

  it('rejects zero, negatives, and non-numbers', () => {
    expect(money.safeParse('0').success).toBe(false);
    expect(money.safeParse('-5').success).toBe(false);
    expect(money.safeParse('abc').success).toBe(false);
  });

  it('never routes an amount through a JS number', () => {
    // 0.1 + 0.2 !== 0.3. A peso that round-trips through a float can arrive a
    // centavo short, and this system decides whether a customer still owes money.
    const balances = codeOnly(read('src', 'lib', 'payments', 'balances.ts'));

    expect(balances).not.toMatch(/parseFloat|Number\(raw\.|toFixed/);
    expect(balances).toContain('String(raw.total_amount_payable)');
  });

  it('formats pesos without converting through a float, decimals only when needed', () => {
    // Whole amounts show NO decimals; fractional amounts show exactly two.
    expect(formatPeso('10750.00')).toBe('₱10,750');
    expect(formatPeso('2250')).toBe('₱2,250');
    expect(formatPeso('0.00')).toBe('₱0');
    expect(formatPeso('1250.50')).toBe('₱1,250.50');
    expect(formatPeso('1000000')).toBe('₱1,000,000');
    // A value a float would mangle survives intact.
    expect(formatPeso('12345678.99')).toBe('₱12,345,678.99');
  });
});

describe('payment recording (approved decision §3)', () => {
  it('accepts a complete bank transfer', () => {
    expect(recordPaymentSchema.safeParse(validBankTransfer).success).toBe(true);
  });

  it('offers no way to record a payment as already verified', () => {
    // Recording is not verifying: the schema strips a caller-supplied status.
    const parsed = recordPaymentSchema.parse({
      ...validBankTransfer,
      status: 'verified',
    });
    expect(parsed).not.toHaveProperty('status');
  });

  it('never accepts card number, CVV, or PIN', () => {
    const parsed = recordPaymentSchema.parse({
      ...validBankTransfer,
      paymentMethod: 'card',
      cardNumber: '4111111111111111',
      cvv: '123',
      pin: '1234',
    });

    expect(parsed).not.toHaveProperty('cardNumber');
    expect(parsed).not.toHaveProperty('cvv');
    expect(parsed).not.toHaveProperty('pin');
  });

  it('defines no card-data field anywhere in the schema or module', () => {
    const schema = codeOnly(read('src', 'lib', 'validation', 'payments.ts'));
    const verification = codeOnly(read('src', 'lib', 'payments', 'verification.ts'));

    for (const forbidden of [/card_number/i, /cardNumber/, /\bcvv\b/i, /\bpin\b/i]) {
      expect(schema).not.toMatch(forbidden);
      expect(verification).not.toMatch(forbidden);
    }
  });

  it('requires a reference number for every method', () => {
    for (const method of PAYMENT_METHODS) {
      const result = recordPaymentSchema.safeParse({
        ...validBankTransfer,
        paymentMethod: method,
        referenceNumber: undefined,
        collectionLocation: 'Main store',
        note: 'note',
      });

      expect(result.success).toBe(false);
    }
  });

  it('no longer requires evidence for non-cash methods (Owner request 2026-07-22)', () => {
    // The Evidence reference field was removed from Record Payment; a non-cash
    // payment without evidence now validates. The transaction reference number and
    // provider remain the required attribution.
    const result = recordPaymentSchema.safeParse({ ...validBankTransfer, evidence: [] });
    expect(result.success).toBe(true);
  });

  it('makes photo evidence optional for cash but demands location', () => {
    // §3: cash needs the receiving staff identity and a reference number; the
    // photo is optional because the attribution is the person, not the picture.
    const withoutPhoto = recordPaymentSchema.safeParse({
      ...validBankTransfer,
      paymentMethod: 'cash',
      provider: undefined,
      evidence: [],
      collectionLocation: 'Main store',
    });
    expect(withoutPhoto.success).toBe(true);

    const withoutLocation = recordPaymentSchema.safeParse({
      ...validBankTransfer,
      paymentMethod: 'cash',
      provider: undefined,
      evidence: [],
    });
    expect(withoutLocation.success).toBe(false);
  });

  it('requires a provider for bank, wallet, and card', () => {
    for (const method of ['bank_transfer', 'e_wallet', 'card'] as const) {
      const result = recordPaymentSchema.safeParse({
        ...validBankTransfer,
        paymentMethod: method,
        provider: undefined,
      });
      expect(result.success).toBe(false);
    }
  });

  it('requires a reason for an "other" method', () => {
    const result = recordPaymentSchema.safeParse({
      ...validBankTransfer,
      paymentMethod: 'other',
      provider: undefined,
    });
    expect(result.success).toBe(false);
  });
});

describe('verification (approved decisions §1, §4)', () => {
  it('requires the amount that actually arrived', () => {
    const result = verifyPaymentSchema.safeParse({
      paymentId: ORDER,
      outcome: 'verified',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a verified amount different from the claimed amount', () => {
    // Only the verified amount reduces the balance — what a payer claims to have
    // sent is not evidence of what arrived.
    const result = verifyPaymentSchema.safeParse({
      paymentId: ORDER,
      outcome: 'verified',
      verifiedAmount: '2100.00',
    });
    expect(result.success).toBe(true);
  });

  it('requires a reason to reject evidence', () => {
    expect(
      verifyPaymentSchema.safeParse({ paymentId: ORDER, outcome: 'rejected' }).success,
    ).toBe(false);
    expect(
      verifyPaymentSchema.safeParse({
        paymentId: ORDER,
        outcome: 'rejected',
        note: 'Screenshot shows a different order',
      }).success,
    ).toBe(true);
  });
});

describe('verification module invariants', () => {
  const verification = read('src', 'lib', 'payments', 'verification.ts');

  it('records every payment as unverified — the caller cannot choose', () => {
    expect(verification).toContain("status: 'submitted_unverified'");
    expect(verification).not.toMatch(/status:\s*data\.status/);
  });

  it('keeps evidence attachment from changing verification status', () => {
    const attachFn = verification.slice(
      verification.indexOf('export async function attachPaymentEvidence'),
      verification.indexOf('export async function verifyPayment'),
    );

    expect(attachFn).not.toMatch(/from\('payments'\)[\s\S]{0,80}\.update/);
    expect(attachFn).toContain('status_changed: false');
  });

  it('never touches inventory, layaway, or orders when verifying', () => {
    // Verification is a statement about money only.
    expect(verification).not.toContain('inventory_reservations');
    expect(verification).not.toContain('layaway_arrangements');
    expect(verification).not.toMatch(/from\('official_orders'\)[\s\S]{0,60}\.update/);
    expect(verification).toContain('inventory_changed: false');
    expect(verification).toContain('layaway_forfeited: false');
  });

  it('never claims Paid in Full from a verification', () => {
    expect(verification).toContain('paid_in_full: false');
  });

  it('flags a duplicate reference rather than rejecting it', () => {
    expect(verification).toContain('duplicate_reference_flagged');
    expect(verification).toContain('auto_rejected: false');
  });

  it('is idempotent — a retried verify cannot double-count', () => {
    expect(verification).toContain("error.code === '23505'");
    expect(verification).toContain('deduplicated: true');
  });

  it('blocks overpayment strictly — record and verify refuse amounts over the balance', () => {
    // Owner decision 2026-07-25: no overpayment. Recording and verifying both
    // gate on the outstanding balance, and the DB trigger's 23514 is surfaced.
    expect(verification).toContain('moneyExceeds');
    expect(verification).toContain('outstandingBalance');
    expect(verification).toContain("error.code === '23514'");
  });

  it('audits denial and failure, not only success', () => {
    expect(verification).toContain("outcome: 'denied'");
    expect(verification).toContain("outcome: 'failed'");
  });

  it('auto-completes on paid-in-full only OUTSIDE the money-only verify path', () => {
    // Owner decision 2026-07-25: a full payment auto-completes the order and
    // retires inventory — but that is a SEPARATE step in the action layer, never
    // inside verification.ts, which must stay money-only.
    expect(verification).not.toContain('complete_order_on_full_payment');
    const actions = read('src', 'lib', 'payments', 'actions.ts');
    expect(actions).toContain('completeOrderForPaymentIfPaidInFull');
    const completeOnPayment = read('src', 'lib', 'orders', 'complete-on-payment.ts');
    expect(completeOnPayment).toContain('complete_order_on_full_payment');
  });
});

describe('balances module', () => {
  const balances = read('src', 'lib', 'payments', 'balances.ts');

  it('computes nothing — every figure comes from the approved SQL', () => {
    // A second implementation in TypeScript could drift from the SQL, and drift
    // here decides whether a customer is told they still owe money.
    expect(balances).toContain("rpc('order_balance'");
    expect(balances).not.toMatch(/outstanding\s*=|payable\s*=\s*.*[-+*]/);
  });

  it('exposes the approved figures including overpayment credit', () => {
    for (const field of [
      'totalAmountPayable',
      'verifiedNetPayments',
      'outstandingBalance',
      'overpaymentCredit',
      'paidInFull',
      'requiredDownPayment',
    ]) {
      expect(balances).toContain(field);
    }
  });
});

describe('layaway terms (approved decisions §5, §6)', () => {
  it('encodes the approved limits', () => {
    expect(LAYAWAY_MIN_MONTHS).toBe(1);
    expect(LAYAWAY_MAX_MONTHS).toBe(3);
    expect(LAYAWAY_MAX_GRACE_DAYS).toBe(10);
    expect(LAYAWAY_DEPOSIT_PERCENT).toBe(20);
  });

  it('rejects a term outside 1–3 months', () => {
    const base = {
      officialOrderId: ORDER,
      depositPaymentId: ORDER,
      finalDueDate: '2026-09-15',
    };

    expect(activateLayawaySchema.safeParse({ ...base, months: 0 }).success).toBe(false);
    expect(activateLayawaySchema.safeParse({ ...base, months: 4 }).success).toBe(false);
    expect(activateLayawaySchema.safeParse({ ...base, months: 3 }).success).toBe(true);
  });

  it('requires a verified deposit payment to activate', () => {
    // Evidence alone never activates layaway (§6) — activation names the payment.
    const result = activateLayawaySchema.safeParse({
      officialOrderId: ORDER,
      months: 2,
      finalDueDate: '2026-09-15',
    });

    expect(result.success).toBe(false);
  });
});

describe('Phase 6 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260715170000_phase6_payment_layaway.sql',
  );
  const sql = migration.replace(/^\s*--.*$/gm, '');

  it('stores no card number, CVV, or PIN', () => {
    for (const forbidden of [/card_number/i, /\bcvv\b/i, /\bpin\b/i]) {
      expect(sql).not.toMatch(forbidden);
    }
  });

  it('uses numeric for every money column, never float', () => {
    expect(sql).not.toMatch(/\b(float|double precision|real)\b/i);
    expect(sql).toMatch(/numeric\(14, 2\)/);
  });

  it('encodes the approved fee formula once', () => {
    expect(sql).toContain('150::numeric * p_total_grams * p_months');
    expect(sql).toContain('round(');
  });

  it('never lets the Outstanding Balance go negative', () => {
    expect(sql).toContain('greatest(');
    expect(sql).toContain('overpayment_credit');
  });

  it('counts only verified, non-void, non-reversed, non-correction payments', () => {
    const fn = sql.slice(
      sql.indexOf('function app_private.verified_net_payments'),
      sql.indexOf('comment on function app_private.verified_net_payments'),
    );

    expect(fn).toContain("p.status = 'verified'");
    expect(fn).toContain("v.outcome = 'verified'");
    expect(fn).toContain('p.voided_at is null');
    expect(fn).toContain('p.reversed_at is null');
    expect(fn).toContain('p.correction_pending = false');
  });

  it('gates verified-payment correction behind Owner approval', () => {
    expect(sql).toContain('enforce_verified_payment_correction');
    expect(sql).toMatch(/requires Owner approval/i);
  });

  it('keeps every new function security invoker and revoked from anon', () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain('revoke all on function public.order_balance');
    expect(sql).toContain('revoke all on function public.duplicate_payment_references');
  });

  it('enables and forces RLS on the new charges table', () => {
    expect(sql).toContain(
      'alter table public.official_order_charges enable row level security',
    );
    expect(sql).toContain(
      'alter table public.official_order_charges force row level security',
    );
  });

  it('never weakens an earlier phase guard', () => {
    expect(sql).not.toMatch(/drop\s+trigger/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/disable row level security/i);
  });

  it('references the approved decisions document rather than inventing rules', () => {
    expect(migration).toContain('docs/PHASE-6-APPROVED-DECISIONS.md');
  });
});
