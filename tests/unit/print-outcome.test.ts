import { describe, expect, it } from 'vitest';

import {
  isDeadOutcome,
  ORDER_CLAIM_STALE_MS,
  ORDER_PRINT_WINDOW_MS,
  printOutcome,
} from '@/lib/print/print-outcome';

/**
 * The "nothing more nothing less" rule in test form (Owner 2026-09-09).
 *
 * These guard a defect that cost 19 real customer stickers: every print failure was terminal and
 * SILENT, so staff saw "sent to the printer" for a sticker that never existed. The decision under
 * test is what turns a dead job into something the operator is told about — and, in the other
 * direction, what must never label a live job dead (which would invite a double print).
 */

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('printOutcome — settled DB statuses are reported verbatim', () => {
  it('reports printed / failed / voided straight through', () => {
    const base = { queued_at: iso(0), claimed_at: null };
    expect(printOutcome({ ...base, status: 'printed' }, NOW)).toBe('printed');
    expect(printOutcome({ ...base, status: 'failed' }, NOW)).toBe('failed');
    expect(printOutcome({ ...base, status: 'voided' }, NOW)).toBe('voided');
  });
});

describe('printOutcome — a queued job dies when the claim window closes', () => {
  it('is still queued inside the window', () => {
    const row = { status: 'queued', queued_at: iso(ORDER_PRINT_WINDOW_MS - 5_000), claimed_at: null };
    expect(printOutcome(row, NOW)).toBe('queued');
  });

  it('is expired once past the window — claim_next_print_job will never serve it again', () => {
    const row = { status: 'queued', queued_at: iso(ORDER_PRINT_WINDOW_MS + 1_000), claimed_at: null };
    expect(printOutcome(row, NOW)).toBe('expired');
  });

  it('does not flip early exactly AT the boundary (strictly greater than)', () => {
    const row = { status: 'queued', queued_at: iso(ORDER_PRINT_WINDOW_MS), claimed_at: null };
    expect(printOutcome(row, NOW)).toBe('queued');
  });
});

describe('printOutcome — a claim held too long means the phone died mid-print', () => {
  it('is printing while the claim is fresh', () => {
    const row = {
      status: 'claimed',
      queued_at: iso(ORDER_CLAIM_STALE_MS + 60_000),
      claimed_at: iso(3_000),
    };
    // The job is OLD, but a live device holds it — claim age wins, so it is in flight, not dead.
    expect(printOutcome(row, NOW)).toBe('printing');
  });

  it('is expired once the claim goes stale (crash / force-stop leaves it stuck forever)', () => {
    const row = {
      status: 'claimed',
      queued_at: iso(ORDER_CLAIM_STALE_MS + 60_000),
      claimed_at: iso(ORDER_CLAIM_STALE_MS + 1_000),
    };
    expect(printOutcome(row, NOW)).toBe('expired');
  });

  it("treats 'printing' the same as 'claimed'", () => {
    const fresh = { status: 'printing', queued_at: iso(0), claimed_at: iso(1_000) };
    const stale = {
      status: 'printing',
      queued_at: iso(0),
      claimed_at: iso(ORDER_CLAIM_STALE_MS + 1_000),
    };
    expect(printOutcome(fresh, NOW)).toBe('printing');
    expect(printOutcome(stale, NOW)).toBe('expired');
  });
});

describe('printOutcome — never invent a death from bad data', () => {
  it('keeps a queued job with an unparseable timestamp as queued, not expired', () => {
    // A parse failure must not be what condemns a job: the DB is the authority on eligibility.
    expect(printOutcome({ status: 'queued', queued_at: 'not-a-date', claimed_at: null }, NOW)).toBe(
      'queued',
    );
    expect(printOutcome({ status: 'queued', queued_at: null, claimed_at: null }, NOW)).toBe('queued');
  });

  it('keeps a claimed job with no claimed_at as printing, not expired', () => {
    expect(printOutcome({ status: 'claimed', queued_at: iso(0), claimed_at: null }, NOW)).toBe(
      'printing',
    );
  });

  it('reports an unknown future status as in flight rather than crying wolf', () => {
    expect(printOutcome({ status: 'something_new', queued_at: iso(0), claimed_at: null }, NOW)).toBe(
      'printing',
    );
  });
});

describe('isDeadOutcome — what the operator must be told about', () => {
  it('counts failed and expired as did-not-print', () => {
    expect(isDeadOutcome('failed')).toBe(true);
    expect(isDeadOutcome('expired')).toBe(true);
  });

  it('does not flag in-flight or successful jobs', () => {
    expect(isDeadOutcome('queued')).toBe(false);
    expect(isDeadOutcome('printing')).toBe(false);
    expect(isDeadOutcome('printed')).toBe(false);
    // 'voided' is a deliberate human decision to close it — not a failure to report.
    expect(isDeadOutcome('voided')).toBe(false);
  });
});

describe('window constants stay in sync with migration 20260909140000', () => {
  it('matches the 60s claim window the DB enforces', () => {
    // If this changes, claim_next_print_job's interval must change with it or the UI will label
    // jobs dead that the DB will still happily print.
    expect(ORDER_PRINT_WINDOW_MS).toBe(60_000);
  });

  it('matches the 2-minute staleness floor requeue_print_job uses as its double-print guard', () => {
    expect(ORDER_CLAIM_STALE_MS).toBe(120_000);
  });
});
