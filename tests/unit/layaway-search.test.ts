import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  uniqueCodeLabel,
  type LayawayAccountRow,
} from '@/lib/payments/layaway-account-row';
import {
  codesMatchedFirst,
  explainLayawayMatch,
  LAYAWAY_NEVER_SEARCHED,
  LAYAWAY_NORM_FROM,
  LAYAWAY_NORM_TO,
  LAYAWAY_SEARCH_FIELDS,
  layawaySearchNorm,
  splitUniqueCodes,
  type LayawaySearchRow,
} from '@/lib/payments/layaway-search';

/**
 * Layaway search must be VISIBLE, USEFUL AND EXPLAINABLE (Owner 2026-09-17).
 *
 * Regression guard for a production bug: DAN OLLUGRAC's row showed the Unique Code
 * `SBA-N-7695 3.10g' 16"`, yet searching that exact text returned "0 total". The layaway was created
 * from an order, so the ledger's own item link is NULL; the table resolves the code from the
 * converted order's claimed item, and the old search never read that path.
 *
 * The behaviour below runs through the canonical TS definition. The SQL is pinned to the same rules
 * by content assertions over the migration, because the production database is not reachable from
 * the test runner. Executing layaway_page itself against the live data is NEEDS VERIFICATION.
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260917120000_layaway_search_visible_codes.sql',
  ),
  'utf8',
);

/** The body of layaway_page as written by the new migration. */
const PAGE_BODY = MIGRATION.slice(
  MIGRATION.indexOf('create or replace function public.layaway_page'),
);
const SEARCHED = PAGE_BODY.slice(
  PAGE_BODY.indexOf('searched as ('),
  PAGE_BODY.indexOf('filtered as ('),
);

/** A line feed, written as a code point. */
const NL = String.fromCharCode(10);

/** The superseded layaway_page (20260913130000): the real control for the regression. */
const OLD_MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260913130000_retired_numbers_and_layaway_near_count.sql',
  ),
  'utf8',
);
const OLD_PAGE_BODY = (() => {
  const start = OLD_MIGRATION.lastIndexOf(
    'create or replace function public.layaway_page',
  );
  return OLD_MIGRATION.slice(start, OLD_MIGRATION.indexOf('$function$;', start));
})();

/** DAN OLLUGRAC as the Owner reported it — an order-derived ledger account. */
const DAN: LayawaySearchRow = {
  source: 'ledger',
  uniqueCodes: [`SBA-N-7695 3.10g' 16"`],
  layawayCode: 'D7',
  accountNo: '412',
  customerName: 'DAN OLLUGRAC',
  financer: null,
  remarks: 'NEZ',
};
// Deliberately NOT on the row, because search must not be able to see them:
const HIDDEN_UUID = '3f6c1b9e-8a27-4d0c-9a55-2f1e7c0b4d11';
const RETIRED_INVOICE = 'INV-2026-143128';
const RETIRED_ORDER = 'ORD-2026-001124';
/** A non-breaking space, written as a code point so the source has no invisible characters. */
const NBSP = String.fromCharCode(160);

describe('the reported bug — the visible Unique Code finds the row', () => {
  it('TEST 1: the exact visible code', () => {
    expect(explainLayawayMatch(DAN, `SBA-N-7695 3.10g' 16"`)).toBe('Unique Code');
  });

  it('TEST 2: the base code', () => {
    expect(explainLayawayMatch(DAN, 'SBA-N-7695')).toBe('Unique Code');
  });

  it('TEST 3: the numeric code', () => {
    expect(explainLayawayMatch(DAN, '7695')).toBe('Unique Code');
  });

  it('TEST 4: the full customer name, in any case', () => {
    expect(explainLayawayMatch(DAN, 'DAN OLLUGRAC')).toBe('Customer Name');
    expect(explainLayawayMatch(DAN, 'Dan Ollugrac')).toBe('Customer Name');
  });

  it('TEST 5: a partial customer name', () => {
    expect(explainLayawayMatch(DAN, 'OLLUGRAC')).toBe('Customer Name');
    expect(explainLayawayMatch(DAN, 'Dan')).toBe('Customer Name');
  });

  it('TEST 6: the Layaway code', () => {
    expect(explainLayawayMatch(DAN, 'D7')).toBe('Code');
  });

  it('TEST 7: the Remarks / Financer value', () => {
    expect(explainLayawayMatch(DAN, 'NEZ')).toBe('Remarks / Financer');
  });

  it('TEST 8/9/10: hidden ids and retired numbers match nothing', () => {
    expect(explainLayawayMatch(DAN, HIDDEN_UUID)).toBeNull();
    expect(explainLayawayMatch(DAN, RETIRED_INVOICE)).toBeNull();
    expect(explainLayawayMatch(DAN, '143128')).toBeNull();
    expect(explainLayawayMatch(DAN, RETIRED_ORDER)).toBeNull();
    expect(explainLayawayMatch(DAN, '001124')).toBeNull();
  });

  it('a near-miss number is NOT a match (no loose numeric matching)', () => {
    expect(explainLayawayMatch(DAN, '7696')).toBeNull();
    expect(explainLayawayMatch(DAN, 'SBA-N-7694')).toBeNull();
  });

  it('the OLD layaway_page never read the order-derived or multi-item codes', () => {
    // The superseded definition matched only the ledger's own item link.
    expect(OLD_PAGE_BODY).toMatch(/coalesce[(]unique_code,''[)]\s+ilike/);
    expect(OLD_PAGE_BODY).not.toContain('converted_layaway_ledger_id');
    expect(OLD_PAGE_BODY).not.toContain('layaway_ledger_items');
    expect(PAGE_BODY).toContain('converted_layaway_ledger_id');
    expect(PAGE_BODY).toContain('public.layaway_ledger_items');
  });
});

describe('normalization — typography never hides a visible value', () => {
  it('curly quotes and primes in the STORED code still match the plain text typed', () => {
    const curly: LayawaySearchRow = { ...DAN, uniqueCodes: ['SBA-N-7695 3.10g’ 16″'] };
    expect(explainLayawayMatch(curly, `SBA-N-7695 3.10g' 16"`)).toBe('Unique Code');
    const curlyDouble: LayawaySearchRow = {
      ...DAN,
      uniqueCodes: ['SBA-N-7695 3.10g‘ 16”'],
    };
    expect(explainLayawayMatch(curlyDouble, `SBA-N-7695 3.10g' 16"`)).toBe('Unique Code');
  });

  it('curly quotes TYPED still match a plain stored code', () => {
    expect(explainLayawayMatch(DAN, 'SBA-N-7695 3.10g’ 16”')).toBe('Unique Code');
  });

  it('case, surrounding spaces, repeated spaces and non-breaking spaces are ignored', () => {
    expect(explainLayawayMatch(DAN, `   sba-n-7695    3.10G'${NBSP}16"  `)).toBe(
      'Unique Code',
    );
    expect(explainLayawayMatch(DAN, '  dan   ollugrac ')).toBe('Customer Name');
  });

  it('normalizes exactly: letters and digits untouched', () => {
    expect(layawaySearchNorm(`  SBA-N-7695  3.10g’${NBSP}16″ `)).toBe(
      `sba-n-7695 3.10g' 16"`,
    );
    expect(layawaySearchNorm(null)).toBe('');
  });

  it('a pasted control character acts as a space, never as a code separator', () => {
    const pasted = 'SBA-N-7695' + String.fromCharCode(1) + '3.10g';
    expect(explainLayawayMatch(DAN, pasted)).toBe('Unique Code');
    const tabbed = 'DAN' + String.fromCharCode(9) + 'OLLUGRAC';
    expect(explainLayawayMatch(DAN, tabbed)).toBe('Customer Name');
  });

  it('folds only the whitespace the SQL always folds; other characters pass through', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(layawaySearchNorm('a' + bom + 'b')).toBe('a' + bom + 'b');
    expect(layawaySearchNorm('A' + String.fromCharCode(13, 10) + 'B')).toBe('a b');
  });

  it('a search never matches ACROSS two codes of one account', () => {
    const multi: LayawaySearchRow = { ...DAN, uniqueCodes: ['SBA-N-7695', '3.10g'] };
    expect(explainLayawayMatch(multi, 'SBA-N-7695 3.10g')).toBeNull();
    expect(explainLayawayMatch(multi, '3.10g')).toBe('Unique Code');
  });
});

describe('the allowlist', () => {
  it('names exactly the approved, visible fields', () => {
    expect(LAYAWAY_SEARCH_FIELDS.map((f) => f.label)).toEqual([
      'Unique Code',
      'Code',
      'Account No.',
      'Customer Name',
      'Remarks / Financer',
    ]);
  });

  it('an arrangement is never matched by its placeholder account number', () => {
    const arrangement: LayawaySearchRow = {
      ...DAN,
      source: 'arrangement',
      accountNo: '—',
    };
    expect(
      explainLayawayMatch(
        {
          ...arrangement,
          customerName: 'X',
          uniqueCodes: [],
          remarks: null,
          layawayCode: null,
        },
        '—',
      ),
    ).toBeNull();
  });

  it('every hidden identifier stays out of the SQL predicate', () => {
    expect(LAYAWAY_NEVER_SEARCHED).toContain('orderNumber');
    // Everything that feeds the predicate (code lookups, acct, flagged), comments stripped.
    const upstream = PAGE_BODY.slice(0, PAGE_BODY.indexOf('searched as ('))
      .split(NL)
      .map((l) => l.split('--')[0])
      .join(NL);
    expect(upstream).not.toMatch(
      /order_number|invoice_number|[^a-z_]id::text|cast[(][^)]*[^a-z_.]id[^a-z_]/,
    );
    expect(PAGE_BODY).toContain("'—'::text as account_no");
    expect(SEARCHED).toMatch(
      /[(]source = 'l'\s+and app_private[.]layaway_search_norm[(]account_no[)]/,
    );
    expect(PAGE_BODY).not.toMatch(/o[.]order_number/);
    expect(SEARCHED).not.toMatch(/order_number|invoice_number|payment_id|audit|::text/);
    expect(SEARCHED).not.toMatch(/\bid\b\s*(::|ilike|like)/);
  });
});

describe('20260917120000 — the SQL enforces the same rules', () => {
  it('is the migration that currently defines layaway_page', () => {
    const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) =>
        readFileSync(join(dir, f), 'utf8').includes('function public.layaway_page('),
      )
      .pop();
    expect(latest).toBe('20260917120000_layaway_search_visible_codes.sql');
  });

  it('leaves the normalizer unpinned (inlinable) and guards the order link column', () => {
    const at = MIGRATION.indexOf(
      'create or replace function app_private.layaway_search_norm',
    );
    const header = MIGRATION.slice(at, MIGRATION.indexOf('as $$', at));
    expect(header).not.toContain('set search_path');
    expect(header).toContain('immutable');
    expect(MIGRATION).toContain("and column_name = 'converted_layaway_ledger_id'");
  });

  it('normalizes with exactly the characters the TS mirror maps', () => {
    const fromCodes = [...LAYAWAY_NORM_FROM].map((c) => c.codePointAt(0));
    expect(fromCodes).toEqual([8220, 8221, 8243, 8216, 8217, 8242, 160]);
    expect(MIGRATION).toContain(
      'chr(8220) || chr(8221) || chr(8243) || chr(8216) || chr(8217) || chr(8242) || chr(160)',
    );
    expect(LAYAWAY_NORM_TO).toBe(`"""''' `);
    expect(MIGRATION).toContain(`'"""' || chr(39) || chr(39) || chr(39) || ' '`);
    expect(MIGRATION).toContain("'\\s+', ' ', 'g'");
  });

  it('matches the Unique Code across ALL three display sources', () => {
    expect(PAGE_BODY).toContain(
      'concat_ws(chr(1), inv.item_code, ic.codes, oc.codes) as search_codes',
    );
    expect(PAGE_BODY).toMatch(
      /from public\.layaway_ledger_items li\s+left join public\.inventory_items ii/,
    );
    expect(PAGE_BODY).toMatch(/o\.converted_layaway_ledger_id as ledger_id/);
    expect(PAGE_BODY).toContain('ac.codes as search_codes');
    // Multi-item codes are searched exactly as the table shows them.
    expect(PAGE_BODY).toContain(
      'string_agg(coalesce(ii.item_code, li.item_code), chr(1))',
    );
  });

  it('normalizes both sides and LIKE-escapes the user text', () => {
    expect(PAGE_BODY).toContain(
      "replace(replace(replace(v_needle, '\\', '\\\\'), '%', '\\%'), '_', '\\_')",
    );
    for (const col of [
      'search_codes',
      'layaway_code',
      'account_no',
      'customer_name',
      'financer_name',
      'remarks',
    ]) {
      expect(SEARCHED).toContain(`app_private.layaway_search_norm(${col})`);
    }
    expect(SEARCHED).not.toMatch(/ilike/);
  });

  it('TEST 11/12: search ANDs with the financer, date and section filters in ONE pipeline', () => {
    // Search, date and financer narrow the same CTE; the section then narrows `searched`.
    expect(SEARCHED).toMatch(/and \(p_date_from = ''/);
    expect(SEARCHED).toMatch(/and \(\s*p_financer = ''/);
    expect(PAGE_BODY).toMatch(/filtered as \(\s*select \* from searched/);
    expect(PAGE_BODY).toContain(
      'public.layaway_matches_section(nstatus, balance_amt, paid_amt, grand_amt,',
    );
  });

  it('rows, total and pagination come from the SAME filtered set', () => {
    expect(PAGE_BODY).toMatch(
      /page_ids as \([\s\S]*?from filtered[\s\S]*?limit greatest/,
    );
    expect(PAGE_BODY).toContain("'total', (select count(*) from filtered)");
    // Section counts stay over `searched` (search + financer + date), as before.
    expect(PAGE_BODY).toMatch(
      /'near_overdue', count\(\*\) filter[\s\S]*?\) from searched/,
    );
  });

  it('keeps the due rules untouched (3 calendar months, 30-day near window)', () => {
    expect(PAGE_BODY).toContain(
      'public.layaway_is_overdue(nstatus, balance_amt, purchase_date, v_today)',
    );
    expect(PAGE_BODY).toContain('between v_today + 1 and v_today + 30');
  });

  it('code lookups only run while a search term is present', () => {
    const lookups = PAGE_BODY.slice(0, PAGE_BODY.indexOf('acct as ('));
    expect(lookups.match(/where v_needle <> ''/g)?.length).toBe(3);
  });

  it('dollar-quoted bodies are balanced', () => {
    expect((MIGRATION.match(/\bas \$\$$/gm) ?? []).length).toBe(
      (MIGRATION.match(/^\$\$;$/gm) ?? []).length,
    );
    expect((MIGRATION.match(/\bas \$function\$/g) ?? []).length).toBe(
      (MIGRATION.match(/^\$function\$;$/gm) ?? []).length,
    );
  });
});

describe('the table shows the matched Unique Code', () => {
  function row(uniqueCode: string | null): LayawayAccountRow {
    return {
      key: 'l-1',
      code: 'D7',
      customerName: 'DAN OLLUGRAC',
      status: 'active',
      remarks: 'NEZ',
      financer: null,
      nextDueDate: null,
      completionDate: null,
      datePurchased: '2026-08-29',
      item: null,
      interest: null,
      grandTotal: '56858.00',
      payment: null,
      balance: null,
      accountNo: '412',
      uniqueCode,
      sourceKind: 'manual',
      facebookUrl: null,
      balanceMismatch: false,
      officialOrderId: null,
      layawayRow: null,
      ledgerId: '1',
    };
  }

  it('puts the code that matched first', () => {
    const r = row(`SBA-E-1001 1.00g, SBA-N-7695 3.10g' 16"`);
    expect(uniqueCodeLabel(r)).toBe('SBA-E-1001 1.00g +1');
    expect(uniqueCodeLabel(r, '7695')).toBe(`SBA-N-7695 3.10g' 16" +1`);
    expect(codesMatchedFirst(['A1', 'B2'], 'nothing')).toEqual(['A1', 'B2']);
  });

  it('never splits a single code that contains a comma (HK prices)', () => {
    expect(splitUniqueCodes('BNA-B-2533 K18 HK ITEM 37,500')).toEqual([
      'BNA-B-2533 K18 HK ITEM 37,500',
    ]);
    expect(uniqueCodeLabel(row('BNA-B-2533 K18 HK ITEM 37,500'))).toBe(
      'BNA-B-2533 K18 HK ITEM 37,500',
    );
  });
});
