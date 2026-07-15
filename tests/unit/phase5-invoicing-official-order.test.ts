import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderInvoiceMessage } from '@/lib/invoicing/messages';

/**
 * Phase 5 guards — Invoicing & Official Order (Bible §15, §6.7–6.8, §22.8–22.9).
 *
 * The order/reservation/number invariants are structural and proven in the
 * pgTAP suite against a real database. These cover the TypeScript surface:
 * message rendering, and the shape of the domain modules.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');

describe('invoice message template', () => {
  const body = renderInvoiceMessage({
    customerDisplayName: 'Ana Reyes',
    orderNumber: 'ORD-2026-000101',
    invoiceNumber: 'INV-2026-000088',
    totalAmount: 12500,
    holdExpiresAt: '2026-07-18T00:00:00Z',
    itemLines: ['Ring 21K ×1 — PHP 12500.00'],
  });

  it('names both references without conflating them', () => {
    expect(body).toContain('ORD-2026-000101');
    expect(body).toContain('INV-2026-000088');
  });

  it('states the total and the hold deadline', () => {
    expect(body).toContain('12500.00');
    expect(body).toMatch(/keep your items reserved/i);
  });

  it('is pure — it contacts nothing', () => {
    const again = renderInvoiceMessage({
      customerDisplayName: 'Ana Reyes',
      orderNumber: 'ORD-2026-000101',
      invoiceNumber: 'INV-2026-000088',
      totalAmount: 12500,
      holdExpiresAt: '2026-07-18T00:00:00Z',
      itemLines: ['Ring 21K ×1 — PHP 12500.00'],
    });

    expect(again).toBe(body);
  });
});

/** Strips comments: a comment NAMING an excluded thing is documentation. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('message module honesty', () => {
  const messages = read('src', 'lib', 'invoicing', 'messages.ts');
  const messagesCode = codeOnly(messages);

  it('never claims delivery or read', () => {
    // Copy != Sent != Delivered != Read. Only the first two are observable.
    expect(messages).toContain('delivery_confirmed: false');
    expect(messages).toContain('read_confirmed: false');
    // Scanned comment-stripped: the doc comment explains WHY there is no
    // delivered_at, and that explanation must survive.
    expect(messagesCode).not.toMatch(/delivered_at/);
    expect(messagesCode).not.toMatch(/read_at/);
  });

  it('implements no real Facebook, Meta, or Pancake delivery', () => {
    expect(messagesCode).not.toMatch(/graph\.facebook|pancake|messenger|fetch\(/i);
  });

  it('treats Copy as an audit fact that changes no status', () => {
    const copyFn = messages.slice(
      messages.indexOf('export async function recordMessageCopied'),
      messages.indexOf('export async function markMessageSent'),
    );

    expect(copyFn).toContain('message.copied');
    expect(copyFn).not.toContain('.update(');
  });

  it('requires the separate message_sending permission to attest a send', () => {
    expect(messages).toContain("requirePermission('message_sending')");
    expect(messages).toContain("requirePermission('message_preparation')");
  });

  it('never creates an Official Order from any message path', () => {
    expect(messages).not.toMatch(/from\('official_orders'\)[\s\S]{0,60}\.insert/);
    expect(messages).toContain('official_order_created: false');
  });
});

describe('approval module', () => {
  const approve = read('src', 'lib', 'invoicing', 'approve.ts');

  it('performs the commit through one atomic function', () => {
    expect(approve).toContain("rpc('approve_and_send_invoice'");
    expect(approve).not.toMatch(/from\('official_orders'\)[\s\S]{0,60}\.insert/);
    expect(approve).not.toContain("from('inventory_reservations')");
  });

  it('checks invoice_preparation before approving', () => {
    expect(approve).toContain("requirePermission('invoice_preparation')");
    expect(approve.indexOf("requirePermission('invoice_preparation')")).toBeLessThan(
      approve.indexOf("rpc('approve_and_send_invoice'"),
    );
  });

  it('audits a deduplicated retry as distinct from a real approval', () => {
    expect(approve).toContain("'invoice.approve_and_send.deduplicated'");
    expect(approve).toContain('official_order_created: !result.deduplicated');
  });

  it('sends no message inside the approval transaction', () => {
    // "Official Order created — message sending failed" must be representable,
    // so the order cannot depend on a message succeeding.
    expect(approve).not.toContain('prepareInvoiceMessage');
    expect(approve).toContain('message_sent: false');
  });

  it('does not roll back successful orders when one draft in a bulk run fails', () => {
    expect(approve).toContain('rolled_back_successful_orders: false');
  });

  it('bulk-approves only drafts that passed review', () => {
    expect(approve).toMatch(/\.eq\('status', 'in_review'\)/);
  });
});

describe('draft eligibility module', () => {
  const drafts = read('src', 'lib', 'invoicing', 'drafts.ts');

  it('recomputes eligibility from stored claims, never from the client', () => {
    expect(drafts).toContain("from('claims')");
    expect(drafts).toContain("eq('status', 'confirmed_claim')");
  });

  it('gives every exclusion a reason', () => {
    for (const reason of [
      'Already in another active Invoice Draft.',
      'Already committed to an Official Order.',
      'Holds no active reservation. It cannot be invoiced.',
    ]) {
      expect(drafts).toContain(reason);
    }
  });

  it('refuses to guess a missing arrangement', () => {
    // Guessing would silently invent a business term and mis-group the invoice.
    expect(drafts).toMatch(/Payment or fulfillment arrangement is not set/);
  });

  it('groups strictly by customer plus both arrangements', () => {
    expect(drafts).toContain(
      '`${claim.customer_id}|${claim.payment_arrangement}|${claim.fulfillment_arrangement}`',
    );
  });

  it('creates no Official Order and sends nothing when preparing', () => {
    // Reading official_order_claims to EXCLUDE already-ordered claims is
    // correct; what must not exist is a write.
    expect(drafts).not.toMatch(/from\('official_orders'\)[\s\S]{0,80}\.insert/);
    expect(drafts).not.toMatch(/from\('customer_messages'\)/);
    expect(drafts).toContain('official_order_created: false');
    expect(drafts).toContain('message_sent: false');
  });

  it('never releases inventory when removing a claim or dissolving a draft', () => {
    // Reading reservations to judge eligibility is correct; writing them is not.
    expect(drafts).not.toMatch(
      /from\('inventory_reservations'\)[\s\S]{0,80}\.(update|insert|delete)/,
    );
    expect(drafts).toContain('reservation_released: false');
  });

  it('computes totals from stored item prices', () => {
    expect(drafts).toContain('total_price_per_piece');
  });
});

describe('Phase 5 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260715160000_phase5_invoicing_official_order.sql',
  );

  it('keeps the approval function security invoker so RLS still applies', () => {
    expect(migration).toContain('security invoker');
    expect(migration).not.toMatch(
      /approve_and_send_invoice[\s\S]{0,400}security definer/,
    );
  });

  it('checks permission inside the transaction', () => {
    expect(migration).toContain("app_private.has_permission('invoice_preparation')");
  });

  it('locks the draft so concurrent approvals yield one order', () => {
    expect(migration).toContain('for update');
  });

  it('is idempotent by draft', () => {
    expect(migration).toContain("'deduplicated', true");
  });

  it('defines the shared 3-day hold exactly once', () => {
    expect(migration).toContain("interval '3 days'");
    expect(migration).toContain('official_order_hold_interval');
  });

  it('enforces grouping at the database', () => {
    expect(migration).toContain('enforce_draft_grouping_rules');
    expect(migration).toMatch(/same customer/i);
    expect(migration).toMatch(/same payment arrangement/i);
    expect(migration).toMatch(/same fulfillment arrangement/i);
  });

  it('lets the database allocate both numbers, never the application', () => {
    // The INSERT names neither number, so both come from their sequence
    // DEFAULTs and can never be regenerated on a message retry.
    const insert = migration.slice(
      migration.indexOf('insert into public.official_orders'),
      migration.indexOf('returning * into v_order'),
    );

    expect(insert).not.toMatch(/order_number/);
    expect(insert).not.toMatch(/invoice_number/);
    expect(migration).toMatch(/§28\.27/);
  });

  it('never weakens the Phase 3 or Phase 4 guards', () => {
    // Scanned comment-stripped: the header legitimately NAMES the Phase 1–4
    // guards it relies on, and that explanation must survive.
    const sql = codeOnly(migration).replace(/^\s*--.*$/gm, '');

    expect(sql).not.toMatch(/drop\s+trigger/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/enforce_capture_creates_pending_only/);
  });

  it('records the provisional number formats and arrangement vocabulary', () => {
    expect(migration).toContain('provisional_fields');
    expect(migration).toContain('§28.27');
  });
});

describe('Phase 5 does not alter the approved navigation', () => {
  it('places the Invoice workspace inside the Orders group, not a sixth nav item', () => {
    const page = read('src', 'app', '(app)', 'orders', 'invoice', 'page.tsx');
    expect(page).toMatch(/sub-route of the Orders group/i);
  });
});
