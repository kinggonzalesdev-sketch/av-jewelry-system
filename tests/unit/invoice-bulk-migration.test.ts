import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Migration 20260925090000: the database side of Send Invoices (claim) + reminders. */
const RAW = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '20260925090000_invoice_bulk_send_and_reminders.sql'),
  'utf8',
);
const SQL = RAW.split(String.fromCharCode(10))
  .filter((l) => !l.trim().startsWith('--'))
  .join(String.fromCharCode(10))
  .toLowerCase();
const body = (fn: string, next: string) => SQL.slice(SQL.indexOf(fn), next ? SQL.indexOf(next) : undefined);

describe('migration 20260925090000', () => {
  it('is additive: no table / column / data removal', () => {
    expect(SQL).not.toMatch(/drop (table|column|function|index|trigger|policy)/);
    expect(SQL).not.toMatch(/alter table|delete from|truncate|rename/);
  });

  it('the claim locks the ORDER row and refuses sent / in-flight / unconfirmed / non-For-Invoice', () => {
    const claim = body(
      'create or replace function public.claim_order_invoice_send',
      'create or replace function public.finalize_order_invoice_send',
    );
    expect(claim).toContain("app_private.has_permission('invoice_preparation')");
    expect(claim).toMatch(/from public\.official_orders o\s+where o\.id = p_order_id\s+for update/);
    expect(claim).toContain("return 'not_for_invoice'");
    expect(claim).toContain("in ('direct_sent', 'manually_sent') then return 'already_sent'");
    expect(claim).toContain("return 'in_progress'");
    expect(claim).toContain("return 'unconfirmed'");
    expect(claim).toContain("status = 'direct_send_pending'");
  });

  it('finalize and release only touch a pending claim; release restores only a pre-send status', () => {
    const release = body('create or replace function public.release_order_invoice_send', 'revoke all');
    expect(release).toContain("p_restore not in ('message_draft', 'ready_to_copy_or_send', 'direct_send_failed')");
    expect(release).toContain("m.status = 'direct_send_pending'");
    const finalize = body(
      'create or replace function public.finalize_order_invoice_send',
      'create or replace function public.release_order_invoice_send',
    );
    expect(finalize).toContain("m.status = 'direct_send_pending'");
  });

  it('closes the new functions to PUBLIC and anon', () => {
    for (const fn of [
      'claim_order_invoice_send(uuid)',
      'finalize_order_invoice_send(uuid, boolean, text)',
      'release_order_invoice_send(uuid, text)',
    ]) {
      expect(SQL).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(SQL).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it('reminders: For Invoice only after a sent invoice, never paid in full, still 1..3 once each', () => {
    const rem = body('create or replace function public.record_order_reminder', 'update public.message_templates');
    expect(rem).toContain("if v_status = 'invoiced' then");
    expect(rem).toContain("m.status in ('direct_sent', 'manually_sent')");
    expect(rem).toContain("elsif v_status <> 'awaiting_required_payment' then");
    expect(rem).toContain("->> 'paid_in_full'");
    expect(rem).toContain('p_number not between 1 and 3');
    expect(rem).toContain('exception when unique_violation');
  });

  it('the Reminder wording drops the retired order number, only while it is the untouched text', () => {
    expect(SQL).toContain("replace(body, 'a friendly reminder for your order {order_number}.', 'a friendly reminder about your order.')");
    expect(SQL).toContain("position('a friendly reminder for your order {order_number}.' in body) > 0");
  });
});
