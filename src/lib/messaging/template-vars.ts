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
// `auto_text` (Owner 2026-08-22) is the Capture Route B "Auto Sent Text Message" —
// its variables + computed values live in lib/messaging/auto-text.ts, but it is a
// first-class editable template key here so Save/Reset/History treat it like the rest.
export const TEMPLATE_KEYS = ['invoice', 'reminder_1', 'auto_text'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// Owner request 2026-08-05: the Reminder template EDITOR was removed from
// Settings → Message Templates. Only these keys get a card there. The reminder is
// still composed and sent from the Orders → For Reminder flow (its own inline
// editor), which reads reminder_1's body straight from the database. `auto_text`
// gets its own card (Owner 2026-08-22), rendered with a dedicated mode-aware editor.
export const EDITABLE_TEMPLATE_KEYS = ['invoice', 'auto_text'] as const;

/** Every variable a template may use, with what it means and a sample value. */
export const TEMPLATE_VARIABLES: ReadonlyArray<{
  token: string;
  description: string;
  sample: string;
}> = [
  { token: '{customer_name}', description: "The customer's name", sample: 'Ana Cruz' },
  // Owner 2026-09-01: {order_number} retired — the order number is no longer a
  // customer-facing identifier, so it is no longer an insertable message variable.
  { token: '{invoice_number}', description: 'Invoice number', sample: 'INV-2026-000013' },
  { token: '{total_amount}', description: 'Total amount payable', sample: '₱34,660' },
  { token: '{balance}', description: 'Remaining balance', sample: '₱29,660' },
  { token: '{due_date}', description: 'Due date', sample: '2026-08-15' },
  {
    token: '{item_name}',
    description: 'Item (or items) ordered',
    sample: 'Bangle, Ring',
  },
  { token: '{grams}', description: 'Total grams', sample: '12.5' },
  // Owner 2026-09-01: price-per-gram on the customer invoice. Derived from the invoice
  // line items (single rate) or "Mixed Rates" when they differ. An optional line —
  // a Fixed-Price order drops the grams/rate lines rather than sending them blank.
  { token: '{price_per_gram}', description: 'Price per gram', sample: '₱7,300' },
  { token: '{payment_status}', description: 'Payment status', sample: 'Partially paid' },
  { token: '{shop_name}', description: 'Your shop name', sample: 'A.V. Jewelry' },
  {
    token: '{contact_number}',
    description: 'Your contact number',
    sample: '0917 000 0000',
  },
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
 * Invoice OPTIONAL tokens (Owner 2026-09-01): a line whose only dynamic content is one of
 * these is DROPPED when the value is empty — so a genuine Fixed-Price invoice omits the
 * grams/rate lines instead of sending "Price Per Gram:" / "Grams: g" blank. Mirrors the
 * proven auto_text suppression. `{total_amount}`/`{balance}` are NEVER drop-triggers.
 */
export const INVOICE_OPTIONAL_TOKENS = ['{price_per_gram}', '{grams}'] as const;

/**
 * Substitute tokens, but first drop any line whose ONLY optional-token values are empty —
 * a line with no optional token is always kept, and a line keeps if any of its optional
 * tokens has a value. Non-optional empty tokens still collapse to '' via renderTemplate.
 */
export function renderWithOptionalLines(
  body: string,
  values: Record<string, string>,
  optionalTokens: readonly string[] = INVOICE_OPTIONAL_TOKENS,
): string {
  const kept = body.split('\n').filter((line) => {
    const present = optionalTokens.filter((t) => line.includes(t));
    if (present.length === 0) return true;
    return present.some((t) => (values[t] ?? '').trim() !== '');
  });
  return renderTemplate(kept.join('\n'), values);
}

/**
 * Tokens used in the body that are NOT supported. A template that references an
 * unknown variable would silently render a blank, so the editor refuses to save it.
 * `supported` defaults to the Invoice/Reminder set; the AUTO TEXT editor passes its
 * own whitelist (AUTO_TEXT_TOKENS) so each template validates against its own variables.
 */
export function unsupportedTokens(
  body: string,
  supported: readonly string[] = SUPPORTED_TOKENS,
): string[] {
  const found = body.match(/\{[a-z_]+\}/g) ?? [];
  return [...new Set(found.filter((t) => !supported.includes(t)))];
}

/** Which tokens a template needs — used to spot missing order data before sending. */
export function tokensUsed(body: string): string[] {
  return [...new Set(body.match(/\{[a-z_]+\}/g) ?? [])];
}
