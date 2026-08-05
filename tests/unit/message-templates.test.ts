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
  it('supports exactly the eleven documented variables', () => {
    expect(SUPPORTED_TOKENS).toEqual([
      '{customer_name}',
      '{order_number}',
      '{invoice_number}',
      '{total_amount}',
      '{balance}',
      '{due_date}',
      '{item_name}',
      '{grams}',
      '{payment_status}',
      '{shop_name}',
      '{contact_number}',
    ]);
  });

  it('covers the invoice and (single) reminder template', () => {
    expect(TEMPLATE_KEYS).toEqual(['invoice', 'reminder_1']);
  });

  it('offers only Invoice in the Settings editor — the Reminder card was removed', () => {
    // Owner request 2026-08-05: no Reminder editor card. reminder_1 stays a valid
    // template key (the For Reminder order flow still renders + sends it), but it is
    // no longer editable from Settings.
    expect(EDITABLE_TEMPLATE_KEYS).toEqual(['invoice']);
    expect(EDITABLE_TEMPLATE_KEYS).not.toContain('reminder_1');
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
