import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeOrderGramsPricing, gramsTokenValue } from '@/lib/orders/grams-pricing';
import { linePricing, rowTotalCentavos, centavosToStr } from '@/lib/orders/item-pricing';
import { validLinePricing } from '@/lib/orders/line-pricing';
import { invoiceEditState, latestItemAddedAt } from '@/lib/orders/invoice-staleness';
import { renderWithOptionalLines } from '@/lib/messaging/template-vars';

/**
 * Authoritative Price Per Gram (Owner 2026-09-26). The rate typed on New Order / Use / Add Item is
 * saved with the order line; Send Invoice prints THAT rate. Legacy lines keep the old derivation.
 */

const row = (over: Partial<Parameters<typeof linePricing>[0]> = {}) => ({
  priceMode: 'per_gram' as const,
  price: '',
  perGram: '6800',
  grams: '1.12',
  ...over,
});

describe('the snapshot a row saves', () => {
  it('per gram: the exact rate and grams, and a price that is exactly grams × rate', () => {
    const r = row();
    expect(linePricing(r, null)).toEqual({
      mode: 'per_gram',
      price_per_gram: '6800.00',
      grams: '1.120',
    });
    const price = centavosToStr(rowTotalCentavos(r, null));
    expect(price).toBe('7616.00');
    expect(validLinePricing(linePricing(r, null), price)).toBe(true);
  });

  it('keeps grams exactly as the total was computed from them (whole milligrams)', () => {
    const r = row({ grams: '1.1239', perGram: '7350.50' });
    const p = linePricing(r, null);
    expect(p).toEqual({ mode: 'per_gram', price_per_gram: '7350.50', grams: '1.123' });
    expect(validLinePricing(p, centavosToStr(rowTotalCentavos(r, null)))).toBe(true);
  });

  it('uses the item’s own grams when none were typed', () => {
    expect(linePricing(row({ grams: '' }), { grams: '2.5' })).toEqual({
      mode: 'per_gram',
      price_per_gram: '6800.00',
      grams: '2.500',
    });
  });

  it('fixed price: no grams, no rate', () => {
    expect(
      linePricing(row({ priceMode: 'fixed', price: '15000' }), { grams: '3.39' }),
    ).toEqual({
      mode: 'fixed',
    });
  });

  it('refuses a price that does not match grams × rate', () => {
    const p = linePricing(row(), null);
    expect(validLinePricing(p, '7600.00')).toBe(false);
    expect(
      validLinePricing({ mode: 'per_gram', price_per_gram: 'abc', grams: '1' }, '1'),
    ).toBe(false);
  });

  it('refuses numbers (not text) cleanly instead of crashing', () => {
    const bad = {
      mode: 'per_gram',
      price_per_gram: 6800,
      grams: 1.12,
    } as unknown as Parameters<typeof validLinePricing>[0];
    expect(validLinePricing(bad, '7616.00')).toBe(false);
  });
});

describe('what the invoice reads (computeOrderGramsPricing)', () => {
  const snap = (rate: string, grams: string, over: Record<string, unknown> = {}) => ({
    itemCode: 'SBA-R-6301 1.12g',
    unitPrice: '7616.00',
    quantity: 1,
    pricingMode: 'per_gram' as const,
    pricePerGramSnapshot: rate,
    gramsSnapshot: grams,
    ...over,
  });

  it('TEST 3: 1.12 g at ₱6,800 → rate 6800, grams 1.12', () => {
    const gp = computeOrderGramsPricing([snap('6800.00', '1.120')]);
    expect(gp.pricePerGram).toBe(6800);
    expect(gramsTokenValue(gp)).toBe('1.12');
    expect(gp.mixedRates).toBe(false);
  });

  it('TEST 6: a later inventory price change does not move the saved rate', () => {
    const gp = computeOrderGramsPricing([
      snap('6800.00', '1.120', { unitPrice: '9999.00' }),
    ]);
    expect(gp.pricePerGram).toBe(6800);
  });

  it('the snapshot wins over grams in the item code', () => {
    const gp = computeOrderGramsPricing([
      snap('6800.00', '1.050', { itemCode: 'SBA-R-6301 1.12g', unitPrice: '7140.00' }),
    ]);
    expect(gp.totalGrams).toBe(1.05);
    expect(gp.pricePerGram).toBe(6800);
  });

  it('keeps a centavo rate exactly (never rounded to the peso)', () => {
    expect(computeOrderGramsPricing([snap('7350.50', '1.000')]).pricePerGram).toBe(
      7350.5,
    );
  });

  it('MULTI-ITEM same rate: one rate, summed grams', () => {
    const gp = computeOrderGramsPricing([
      snap('6800.00', '1.320'),
      snap('6800.00', '0.880'),
    ]);
    expect(gp.pricePerGram).toBe(6800);
    expect(gramsTokenValue(gp)).toBe('2.2');
  });

  it('TEST 9: MIXED rates never become one invented number', () => {
    const gp = computeOrderGramsPricing([
      snap('6800.00', '1.320'),
      snap('7100.00', '0.880'),
    ]);
    expect(gp.mixedRates).toBe(true);
    expect(gp.pricePerGram).toBeNull();
  });

  it('TEST 10: a FIXED line carries no grams and no rate, even with grams in its code', () => {
    const gp = computeOrderGramsPricing([
      {
        itemCode: 'SBA-R-6301 3.39g',
        unitPrice: '24747.00',
        quantity: 1,
        pricingMode: 'fixed',
      },
    ]);
    expect(gp.hasGrams).toBe(false);
    expect(gp.pricePerGram).toBeNull();
  });

  it('an HK ITEM never shows grams or a rate, even if it was saved per gram', () => {
    const gp = computeOrderGramsPricing([
      snap('7000.00', '2.000', {
        itemCode: 'BNA-B-2533 K18 HK ITEM 2g',
        unitPrice: '14000.00',
      }),
    ]);
    expect(gp.hasGrams).toBe(false);
    expect(gp.pricePerGram).toBeNull();
  });

  it('a legacy line (no snapshot) is derived exactly as before', () => {
    const gp = computeOrderGramsPricing([
      { itemCode: 'SBA-R-6301 3.39g', unitPrice: '24747.00', quantity: 1 },
    ]);
    expect(gp.pricePerGram).toBe(7300);
    expect(gramsTokenValue(gp)).toBe('3.39');
  });
});

describe('the invoice text', () => {
  // The live 'invoice' body after migration 20260926090000 adds the variable to its bare line.
  const body =
    'Here are your order details:\nPrice Per gram: {price_per_gram}\nGrams: {grams}\nTotal Amount: {total_amount}\nBalance: {balance}';

  it('prints "Price Per gram: ₱6,800/g" for the Owner’s example', () => {
    const out = renderWithOptionalLines(body, {
      '{price_per_gram}': '₱6,800/g',
      '{grams}': '1.12',
      '{total_amount}': '₱7,616',
      '{balance}': '₱7,616',
    });
    expect(out).toBe(
      'Here are your order details:\nPrice Per gram: ₱6,800/g\nGrams: 1.12\nTotal Amount: ₱7,616\nBalance: ₱7,616',
    );
  });

  it('a fixed-price order drops the rate and grams lines (no fake values)', () => {
    const out = renderWithOptionalLines(body, {
      '{price_per_gram}': '',
      '{grams}': '',
      '{total_amount}': '₱15,000',
      '{balance}': '₱15,000',
    });
    expect(out).not.toMatch(/Price Per gram|Grams/);
  });
});

describe('an invoice written before an item was added (TEST 8 / Phase 6)', () => {
  const items = [
    { addedAt: '2026-09-26T01:00:00.000Z' },
    { addedAt: '2026-09-26T03:00:00.000Z' },
  ];

  it('finds the newest item', () => {
    expect(latestItemAddedAt(items)).toBe('2026-09-26T03:00:00.000Z');
    expect(latestItemAddedAt([])).toBeNull();
  });

  it('a sent invoice older than the new item needs a new Send Invoice', () => {
    expect(
      invoiceEditState('2026-09-26T03:00:00.000Z', {
        status: 'direct_sent',
        updatedAt: '2026-09-26T02:00:00.000+00:00',
      }),
    ).toBe('sent_outdated');
  });

  it('an unsent draft older than the new item is rebuilt, never sent as is', () => {
    expect(
      invoiceEditState('2026-09-26T03:00:00.000Z', {
        status: 'ready_to_copy_or_send',
        updatedAt: '2026-09-26T02:00:00Z',
      }),
    ).toBe('draft_outdated');
  });

  it('saving a rebuilt text over a SENT invoice does not clear the flag — only a new send does', () => {
    const changed = '2026-09-26T03:00:00.000Z';
    expect(
      invoiceEditState(changed, {
        status: 'direct_sent',
        updatedAt: '2026-09-26T04:00:00Z', // saved after the item was added
        lastSentAt: '2026-09-26T02:00:00Z', // but sent before it
      }),
    ).toBe('sent_outdated');
    expect(
      invoiceEditState(changed, {
        status: 'direct_sent',
        updatedAt: '2026-09-26T05:00:00Z',
        lastSentAt: '2026-09-26T05:00:00Z', // sent again
      }),
    ).toBe('current');
  });

  it('a message written after the last item change is current', () => {
    expect(
      invoiceEditState('2026-09-26T03:00:00.000Z', {
        status: 'direct_sent',
        updatedAt: '2026-09-26T04:00:00Z',
      }),
    ).toBe('current');
    expect(invoiceEditState('2026-09-26T03:00:00.000Z', null)).toBe('current');
  });
});

describe('migration 20260926090000 (not applied by this change)', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'supabase',
      'migrations',
      '20260926090000_order_line_price_snapshot.sql',
    ),
    'utf8',
  );

  it('is additive: nullable columns, no drop / rename / delete of business data', () => {
    expect(sql).toMatch(/add column if not exists pricing_mode text,/);
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(sql).not.toMatch(/\brename\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    // Every added column is nullable: existing rows stay NULL (legacy lines).
    expect(sql).not.toMatch(/add column[^\n,;]*not null/i);
  });

  it('leaves the existing functions untouched and wraps them', () => {
    expect(sql).not.toMatch(
      /create or replace function public\.create_new_order_multi\(/,
    );
    expect(sql).not.toMatch(/create or replace function public\.add_order_item\(/);
    expect(sql).toMatch(/v_res := public\.create_new_order_multi\(/);
    expect(sql).toMatch(/v_res := public\.add_order_item\(/);
  });

  it('closes every new function to anon and PUBLIC', () => {
    expect(sql).toMatch(
      /revoke all on function app_private\.apply_line_pricing\(uuid, jsonb, numeric\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.create_new_order_multi_priced\(uuid, text, jsonb, uuid\) from public, anon;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.add_order_items_priced\(uuid, jsonb\) from public, anon;/,
    );
  });

  it('locks the order row before adding items, and requires the Owner', () => {
    expect(sql).toMatch(/where o\.id = p_order_id for update;/);
    // "is distinct from": a caller with no staff role (NULL) is refused too.
    expect(sql).toMatch(/current_staff_role\(\) is distinct from 'owner'/);
    // A direct API write can never set or change a line's snapshot.
    expect(sql).toMatch(/if current_user in \('authenticated', 'anon'\) then/);
    expect(sql).toMatch(/before insert or update on public\.claims/);
  });

  it('only fills the invoice template’s bare line, and keeps its history', () => {
    expect(sql).toMatch(/position\('\{price_per_gram\}' in v_body\) = 0/);
    expect(sql).toMatch(/insert into public\.message_template_history/);
  });
});
