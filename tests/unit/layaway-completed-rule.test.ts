import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Locks the Completed-Layaway rule against the two regressions it has already had.
 *
 * The rule now lives in SQL — the Layaway table is server-paginated (P1-B), so the DB decides
 * every section via `layaway_matches_section` in the layaway_page migration. The rule itself is
 * UNCHANGED: a record whose status is Completed (in ANY casing) belongs under Completed Layaways
 * when NOTHING is still owed. It must NOT additionally require a non-zero grand total — most
 * imported historical accounts closed long ago and carry no money columns at all, and a
 * `grand > 0` guard silently hid 191 of 199 real completed records.
 */
const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260818100000_layaway_server_side_pagination.sql',
  ),
  'utf8',
);

describe('Completed Layaways — inclusion rule (server-side, layaway_matches_section)', () => {
  const completedBranch = sql.slice(
    sql.indexOf("when 'completed' then"),
    sql.indexOf("when 'overdue' then"),
  );

  it('treats "nothing owed" as completed, including a small overpayment', () => {
    expect(completedBranch).toMatch(/p_nstatus = 'completed'/);
    expect(completedBranch).toMatch(/coalesce\(p_balance,0\) <= 0/);
    expect(completedBranch).toMatch(/coalesce\(p_paid,0\) >= coalesce\(p_grand,0\)/);
  });

  it('does NOT require a non-zero grand total (that hid imported historical records)', () => {
    expect(completedBranch).not.toMatch(/p_grand > 0/);
    expect(completedBranch).not.toMatch(/grand_total > 0/);
  });

  it('compares status case-insensitively so COMPLETED and Completed are one status', () => {
    // Every status is lower-trimmed once (nstatus) before any section match.
    expect(sql).toMatch(/lower\(btrim\(l\.status\)\)/);
  });

  it('excludes Needs Review rows from every section, count and summary', () => {
    expect(sql).toMatch(/lower\(btrim\(l\.status\)\) <> 'needs_review'/);
  });

  it('keeps completed/forfeited/cancelled OUT of Active — terminal statuses', () => {
    expect(sql).toMatch(/p_nstatus not in \('completed','forfeited','cancelled'\)/);
  });
});
