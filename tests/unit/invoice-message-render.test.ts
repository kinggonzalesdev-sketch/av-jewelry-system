import { describe, expect, it } from 'vitest';

import {
  INVOICE_OPTIONAL_TOKENS,
  renderWithOptionalLines,
  SUPPORTED_TOKENS,
} from '@/lib/messaging/template-vars';

const BODY = [
  'Hi {customer_name}!',
  '',
  'Here are your order details:',
  'Price Per Gram: {price_per_gram}',
  'Grams: {grams}g',
  'Total Amount: {total_amount}',
  'Balance: {balance}',
].join('\n');

describe('invoice token contract (Owner 2026-09-01)', () => {
  it('no longer offers {order_number} as a message variable', () => {
    expect(SUPPORTED_TOKENS).not.toContain('{order_number}');
  });
  it('offers {price_per_gram}', () => {
    expect(SUPPORTED_TOKENS).toContain('{price_per_gram}');
  });
  it('grams + price/g are the invoice optional (suppressible) tokens', () => {
    expect(INVOICE_OPTIONAL_TOKENS).toEqual(['{price_per_gram}', '{grams}']);
  });
});

describe('renderWithOptionalLines — grams-based vs fixed price', () => {
  it('grams-based invoice keeps and fills the grams + rate lines', () => {
    const out = renderWithOptionalLines(BODY, {
      '{customer_name}': 'Glaiza Sale Galang',
      '{price_per_gram}': '₱7,300',
      '{grams}': '1.07',
      '{total_amount}': '₱7,811',
      '{balance}': '₱7,811',
    });
    expect(out).toContain('Price Per Gram: ₱7,300');
    expect(out).toContain('Grams: 1.07g');
    expect(out).toContain('Total Amount: ₱7,811');
    expect(out).toContain('Balance: ₱7,811');
  });

  it('fixed-price invoice DROPS the grams + rate lines (no blanks)', () => {
    const out = renderWithOptionalLines(BODY, {
      '{customer_name}': 'Ana Cruz',
      '{price_per_gram}': '',
      '{grams}': '',
      '{total_amount}': '₱12,500',
      '{balance}': '₱12,500',
    });
    expect(out).not.toContain('Price Per Gram');
    expect(out).not.toContain('Grams:');
    expect(out).toContain('Total Amount: ₱12,500');
    expect(out).toContain('Balance: ₱12,500');
    // No dangling blank label lines left behind.
    expect(out).not.toMatch(/Price Per Gram:\s*$/m);
  });

  it('"Mixed Rates" keeps the rate line (a real value, not empty)', () => {
    const out = renderWithOptionalLines(BODY, {
      '{customer_name}': 'Ana Cruz',
      '{price_per_gram}': 'Mixed Rates',
      '{grams}': '5.5',
      '{total_amount}': '₱40,000',
      '{balance}': '₱40,000',
    });
    expect(out).toContain('Price Per Gram: Mixed Rates');
    expect(out).toContain('Grams: 5.5g');
  });
});
