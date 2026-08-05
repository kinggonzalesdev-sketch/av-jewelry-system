/**
 * The message-template variable contract.
 *
 * Deliberately NOT `server-only`: the editor is a client component and must show
 * the SAME variable list and preview substitution the server uses when it renders
 * the real message, so the two cannot drift.
 */

// Owner request: the For Reminder flow now sends a SINGLE reminder, so reminder_2
// and reminder_3 were retired (removed from Settings and the database). reminder_1
// stays a valid key because the For Reminder order flow still renders + sends it.
export const TEMPLATE_KEYS = ['invoice', 'reminder_1'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// Owner request 2026-08-05: the Reminder template EDITOR was removed from
// Settings → Message Templates. Only these keys get a card there. The reminder is
// still composed and sent from the Orders → For Reminder flow (its own inline
// editor), which reads reminder_1's body straight from the database.
export const EDITABLE_TEMPLATE_KEYS = ['invoice'] as const;

/** Every variable a template may use, with what it means and a sample value. */
export const TEMPLATE_VARIABLES: ReadonlyArray<{
  token: string;
  description: string;
  sample: string;
}> = [
  { token: '{customer_name}', description: "The customer's name", sample: 'Ana Cruz' },
  { token: '{order_number}', description: 'Order number', sample: 'ORD-2026-000013' },
  { token: '{invoice_number}', description: 'Invoice number', sample: 'INV-2026-000013' },
  { token: '{total_amount}', description: 'Total amount payable', sample: '₱34,660' },
  { token: '{balance}', description: 'Remaining balance', sample: '₱29,660' },
  { token: '{due_date}', description: 'Due date', sample: '2026-08-15' },
  { token: '{item_name}', description: 'Item (or items) ordered', sample: 'Bangle, Ring' },
  { token: '{grams}', description: 'Total grams', sample: '12.5' },
  { token: '{payment_status}', description: 'Payment status', sample: 'Partially paid' },
  { token: '{shop_name}', description: 'Your shop name', sample: 'A.V. Jewelry' },
  { token: '{contact_number}', description: 'Your contact number', sample: '0917 000 0000' },
];

/** Just the tokens — the whitelist a template is validated against. */
export const SUPPORTED_TOKENS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.token);

/** Sample values, for the editor's live preview. */
export const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.token, v.sample]),
);

/**
 * Substitute `{token}` occurrences. Line breaks and spacing are preserved exactly —
 * only the tokens change. A token with no value becomes an empty string rather than
 * leaving `{balance}` visible in a message a customer would read.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{[a-z_]+\}/g, (token) => values[token] ?? '');
}

/**
 * Tokens used in the body that are NOT supported. A template that references an
 * unknown variable would silently render a blank, so the editor refuses to save it.
 */
export function unsupportedTokens(body: string): string[] {
  const found = body.match(/\{[a-z_]+\}/g) ?? [];
  return [...new Set(found.filter((t) => !SUPPORTED_TOKENS.includes(t)))];
}

/** Which tokens a template needs — used to spot missing order data before sending. */
export function tokensUsed(body: string): string[] {
  return [...new Set(body.match(/\{[a-z_]+\}/g) ?? [])];
}
