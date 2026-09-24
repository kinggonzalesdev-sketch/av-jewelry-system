import { describe, expect, it } from 'vitest';

import {
  EDITABLE_TEMPLATE_KEYS,
  renderTemplate,
  SAMPLE_VALUES,
  SUPPORTED_TOKENS,
  TEMPLATE_KEYS,
  TEMPLATE_VARIABLES,
  tokensUsed,
  unsupportedTokens,
} from '@/lib/messaging/template-vars';

describe('message template variables', () => {
  it('supports exactly the ten documented variables', () => {
    // Owner 2026-09-01: {order_number} retired (order number no longer customer-facing);
    // {price_per_gram} added for the grams-based invoice.
    // Owner 2026-09-13: {invoice_number} retired too — no internal reference number reaches
    // a customer. Ten variables.
    expect(SUPPORTED_TOKENS).toEqual([
      '{customer_name}',
      '{total_amount}',
      '{balance}',
      '{due_date}',
      '{item_name}',
      '{grams}',
      '{price_per_gram}',
      '{payment_status}',
      '{shop_name}',
      '{contact_number}',
    ]);
    expect(SUPPORTED_TOKENS).not.toContain('{order_number}');
    expect(SUPPORTED_TOKENS).not.toContain('{invoice_number}');
  });

  it('covers invoice, the single reminder, and the AUTO TEXT template', () => {
    expect(TEMPLATE_KEYS).toEqual(['invoice', 'reminder_1', 'auto_text']);
  });

  it('offers Invoice, Reminder and Auto Sent Text Message in the Settings editor', () => {
    // The Reminder card was removed on 2026-08-05 and brought back on 2026-09-25 (Owner
    // decision): reminders are sent from Orders → Send Invoices using reminder_1.
    // Owner 2026-08-22: the Capture AUTO TEXT (auto_text) is editable too.
    expect(EDITABLE_TEMPLATE_KEYS).toEqual(['invoice', 'reminder_1', 'auto_text']);
    expect(TEMPLATE_KEYS).toContain('reminder_1');
  });

  it('gives every variable a sample value for the live preview', () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(SAMPLE_VALUES[v.token], `${v.token} needs a sample`).toBeTruthy();
    }
  });
});

describe('rendering', () => {
  it('substitutes values and PRESERVES line breaks and spacing', () => {
    const body = 'Hi {customer_name}!\n\n  Balance: {balance}\nThanks.';
    const out = renderTemplate(body, {
      '{customer_name}': 'Ana',
      '{balance}': '₱500',
    });
    expect(out).toBe('Hi Ana!\n\n  Balance: ₱500\nThanks.');
  });

  it('renders an unfilled token as empty rather than leaving it visible', () => {
    // A customer must never receive the literal text "{balance}".
    expect(renderTemplate('Balance: {balance}', {})).toBe('Balance: ');
  });

  it('leaves text with no variables untouched', () => {
    expect(renderTemplate('Plain message.', SAMPLE_VALUES)).toBe('Plain message.');
  });
});

describe('validation', () => {
  it('flags unsupported variables', () => {
    expect(unsupportedTokens('Hi {customer_name}, ref {not_a_token}.')).toEqual([
      '{not_a_token}',
    ]);
  });

  it('accepts a template using only supported variables', () => {
    expect(unsupportedTokens('Hi {customer_name}, balance {balance}.')).toEqual([]);
  });

  it('reports each unsupported variable once', () => {
    expect(unsupportedTokens('{nope} then {nope} again')).toEqual(['{nope}']);
  });

  it('lists the tokens a template needs, so missing order data can be caught', () => {
    expect(tokensUsed('Hi {customer_name}, balance {balance}, due {due_date}.')).toEqual([
      '{customer_name}',
      '{balance}',
      '{due_date}',
    ]);
  });
});
