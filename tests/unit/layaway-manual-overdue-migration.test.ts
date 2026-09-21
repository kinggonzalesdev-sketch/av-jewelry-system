import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const RAW = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260921130000_manual_layaway_overdue.sql'),
  'utf8',
);
const OVERDUE_RULE = readFileSync(
  join(
    ROOT,
    'supabase',
    'migrations',
    '20260829150000_layaway_overdue_three_month_rule.sql',
  ),
  'utf8',
);
const LEDGER_SERVICE = readFileSync(
  join(ROOT, 'src', 'lib', 'payments', 'layaway-ledger.ts'),
  'utf8',
);

function normalizedSql(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('--'))
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const SQL = normalizedSql(RAW);
const rpcStart = SQL.indexOf(
  'create or replace function public.update_layaway_ledger_and_transfer_overdue(',
);
const rpcEnd = SQL.indexOf(
  'comment on function public.update_layaway_ledger_and_transfer_overdue(',
  rpcStart,
);
const RPC = SQL.slice(rpcStart, rpcEnd);

describe('migration 20260921130000 — manual Layaway Overdue destination', () => {
  it('stores the explicit transition date and actor independently of due-date derivation', () => {
    expect(SQL).toContain('add column if not exists manual_overdue_at timestamptz');
    expect(SQL).toContain('add column if not exists manual_overdue_by uuid');
    expect(SQL).not.toContain('create or replace function public.layaway_overdue_date');
    expect(SQL).not.toContain('create or replace function public.layaway_is_overdue');
    expect(SQL).not.toContain("interval '3 months'");
  });

  it('lands in Overdue and leaves both the Active list and Active overview total', () => {
    expect(RPC).toContain("status = 'overdue'");
    expect(OVERDUE_RULE).toContain(
      "when p_nstatus in ('overdue','grace_period','forfeiture_eligible') then true",
    );
    expect(OVERDUE_RULE).toContain(
      "else (p_nstatus not in ('completed','forfeited','cancelled')",
    );
    expect(OVERDUE_RULE).toContain(
      'and not public.layaway_is_overdue(p_nstatus, p_balance, p_date_purchased, p_today)',
    );
    expect(LEDGER_SERVICE).toContain(".eq('status', 'active')");
  });

  it('keeps a manually-overdue ledger out of Active after later edits', () => {
    expect(SQL).toContain(
      'create or replace function app_private.enforce_manual_overdue_not_active()',
    );
    expect(SQL).toContain(
      "if old.manual_overdue_at is not null and new.status = 'active' then",
    );
    expect(SQL).toContain(
      "and new.status = 'overdue' and coalesce(new.balance, 0) <= 0 then",
    );
    expect(SQL).toContain('before update of status, balance on public.layaway_ledger');
    expect(SQL).toContain("when v_manual_overdue_at is not null then 'overdue'");
  });

  it('uses one pinned SECURITY DEFINER RPC and both existing permissions', () => {
    expect(RPC).toContain("security definer set search_path = ''");
    expect(RPC).toContain("app_private.has_permission('layaway_edit')");
    expect(RPC).toContain("app_private.has_permission('fulfillment_preparation')");
    expect(SQL).toContain(
      'revoke all on function public.update_layaway_ledger_and_transfer_overdue(',
    );
    expect(SQL).toContain(') from public, anon');
    expect(SQL).toContain(') to authenticated, service_role');
  });

  it('serializes on the ledger and makes a retry a no-op before any release/audit', () => {
    expect(RPC).toMatch(
      /select \* into v_ledger from public\.layaway_ledger where id = p_id for update/,
    );
    expect(RPC).toContain('if v_ledger.manual_overdue_at is not null then');
    expect(RPC).toContain("'deduplicated', true");
    expect(RPC).toContain("'changed', false");
    expect(RPC.indexOf("'changed', false")).toBeLessThan(
      RPC.indexOf('insert into public.returned_to_stock_reviews'),
    );
    expect(RPC.indexOf("'changed', false")).toBeLessThan(
      RPC.indexOf('insert into public.audit_events'),
    );
  });

  it('resolves and locks direct, multi-item and converted-order inventory links', () => {
    expect(RPC).toContain('select v_ledger.inventory_item_id as inventory_item_id union');
    expect(RPC).toContain(
      'select li.inventory_item_id from public.layaway_ledger_items li where li.ledger_id = p_id union',
    );
    expect(RPC).toContain(
      'join public.official_order_claims ooc on ooc.official_order_id = o.id join public.claims c on c.id = ooc.claim_id where o.converted_layaway_ledger_id = p_id',
    );
    expect(RPC).toMatch(
      /from public\.inventory_items i where i\.id = any\(v_item_ids\) order by i\.id for update/,
    );
    expect(RPC).toMatch(/order by r\.id for update of r/);
  });

  it('returns the same rows through attributed RTS evidence and never copies inventory', () => {
    expect(SQL).toContain("'layaway_manual_overdue_disposition'");
    expect(RPC).toContain('insert into public.returned_to_stock_reviews');
    expect(RPC).toContain("'approved_return'");
    expect(RPC).toContain("'returned_to_available'");
    expect(RPC).toContain("set availability_status = 'available'");
    expect(RPC).toContain('where id = v_item_id');
    expect(RPC).not.toContain('insert into public.inventory_items');
    expect(RPC).not.toContain('delete from public.inventory_items');
    expect(RPC).not.toContain('update public.inventory_items set item_code');
  });

  it('handles every distinct linked item and releases only this ledger source reservations', () => {
    expect(RPC).toContain('foreach v_item_id in array v_releasable_item_ids loop');
    expect(RPC).toContain('o.converted_layaway_ledger_id = p_id and r.state in');
    expect(RPC).toContain("set state = 'released'");
    expect(RPC).toContain('a linked item has another active reservation');
    expect(RPC).toContain('a linked item is also held by another open layaway');
  });

  it('preserves code and all payment/installment history', () => {
    for (const forbidden of [
      'insert into public.layaway_ledger_payments',
      'update public.layaway_ledger_payments',
      'delete from public.layaway_ledger_payments',
      'insert into public.layaway_ledger_installments',
      'update public.layaway_ledger_installments',
      'delete from public.layaway_ledger_installments',
      'delete from public.layaway_code_pool',
      'set layaway_code =',
    ]) {
      expect(RPC).not.toContain(forbidden);
    }
    expect(RPC).toContain("'payment_history_preserved', true");
    expect(RPC).toContain("'layaway_code', v_ledger.layaway_code");
  });

  it('writes one success audit after inventory and ledger mutations in the same transaction', () => {
    const inventoryMutation = RPC.indexOf("set availability_status = 'available'");
    const ledgerMutation = RPC.indexOf("status = 'overdue'");
    const auditInsert = RPC.indexOf('insert into public.audit_events');

    expect(inventoryMutation).toBeGreaterThan(-1);
    expect(ledgerMutation).toBeGreaterThan(inventoryMutation);
    expect(auditInsert).toBeGreaterThan(ledgerMutation);
    expect(RPC.match(/insert into public\.audit_events/g)).toHaveLength(1);
    expect(RPC).toContain("'manual_overdue_at', v_now");
    expect(RPC).toContain("'performed_by_staff_id', v_staff");
    expect(RPC).toContain("'inventory_rows_created', 0");
  });
});
