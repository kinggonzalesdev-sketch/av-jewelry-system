import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  INVOICE_OPTIONAL_TOKENS,
  renderWithOptionalLines,
  TEMPLATE_VARIABLES,
} from '@/lib/messaging/template-vars';

/**
 * The Invoice Number (Owner 2026-09-13) joins the Order Number (Owner 2026-09-01) as a RETIRED
 * identifier: it exists in the database for uniqueness and history, and nowhere a user can see,
 * search, export, or receive in a message. These are structural guards over the source tree, the
 * migrations, and the message renderer, so a retired number cannot quietly reappear.
 */

const ROOT = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** User-facing source: components + app routes, minus the dev-only prototype (404 in production). */
const USER_FACING_FILES = [
  ...walk(join(ROOT, 'src', 'components')),
  ...walk(join(ROOT, 'src', 'app')),
].filter((f) => /\.(tsx?|css)$/.test(f) && !/[\\/]preview[\\/]/.test(f));

/** Strip comments so an explanatory "// Invoice Number removed" note is not a false positive. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('TEST 7: no visible Invoice Number anywhere user-facing', () => {
  it('renders no "Invoice Number" / "Invoice #" label and no INV- literal', () => {
    const offenders: string[] = [];
    for (const f of USER_FACING_FILES) {
      const code = withoutComments(readFileSync(f, 'utf8'));
      if (/Invoice Number|Invoice #|Invoice No\.|\bINV-\d/.test(code)) {
        offenders.push(f.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads no invoiceNumber into anything rendered', () => {
    // A component that still holds the value is one refactor away from showing it again.
    const offenders: string[] = [];
    for (const f of USER_FACING_FILES) {
      const code = withoutComments(readFileSync(f, 'utf8'));
      if (/\.invoiceNumber\b/.test(code)) offenders.push(f.slice(ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});

describe('TEST 8: the retired Order Number did not come back', () => {
  it('renders no "Order Number" / "Order No." label and no ORD- literal', () => {
    const offenders: string[] = [];
    for (const f of USER_FACING_FILES) {
      const code = withoutComments(readFileSync(f, 'utf8'));
      if (/Order Number|Order No\.|Order\/Account No|\bORD-\d/.test(code)) {
        offenders.push(f.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('customer message templates cannot carry either number', () => {
  it('offers no {invoice_number} or {order_number} chip', () => {
    const tokens = TEMPLATE_VARIABLES.map((v) => v.token);
    expect(tokens).not.toContain('{invoice_number}');
    expect(tokens).not.toContain('{order_number}');
  });

  it('drops the whole "Invoice No.: …" and "Order No.: …" lines from an old or reset body', () => {
    // This is the stored default_body shape in production; a Reset to Default restores it.
    const body = [
      'Hi {customer_name},',
      'Order No.: {order_number}',
      'Invoice No.: {invoice_number}',
      'Total: {total_amount}',
    ].join('\n');
    const out = renderWithOptionalLines(
      body,
      {
        '{customer_name}': 'Ana',
        '{order_number}': '',
        '{invoice_number}': '',
        '{total_amount}': '₱1,000',
      },
      INVOICE_OPTIONAL_TOKENS,
    );
    expect(out).toBe('Hi Ana,\nTotal: ₱1,000');
    expect(out).not.toMatch(/Invoice|Order No/);
  });
});

describe('search RPCs no longer match retired numbers', () => {
  const m2 = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20260913130000_retired_numbers_and_layaway_near_count.sql'),
    'utf8',
  );

  function body(sql: string, fn: string): string {
    const start = sql.indexOf(`function public.${fn}(`);
    return sql.slice(start, sql.indexOf('$function$;', start)).replace(/--.*$/gm, '');
  }

  it('orders_page searches only the waybill and customer name', () => {
    const b = body(m2, 'orders_page');
    expect(b).not.toMatch(/order_number/);
    expect(b).not.toMatch(/invoice_number/);
    expect(b).toMatch(/waybill_number,''\) ilike/);
    expect(b).toMatch(/customer_name,''\) ilike/);
  });

  it('inventory_item_dependencies never labels an order by a number or a UUID', () => {
    const b = body(m2, 'inventory_item_dependencies');
    expect(b).not.toMatch(/o\.order_number|o\.invoice_number|o\.id::text/);
    expect(b).toMatch(/cust\.display_name/);
  });

  it('layaway_page no longer maps the order number into account_no, and reports near_overdue', () => {
    const b = body(m2, 'layaway_page');
    expect(b).not.toMatch(/o\.order_number/);
    expect(b).toMatch(/'near_overdue', count\(\*\) filter/);
  });
});
