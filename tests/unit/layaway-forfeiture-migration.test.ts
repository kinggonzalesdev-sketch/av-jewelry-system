import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const RAW = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260921120000_layaway_ledger_forfeiture.sql'),
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
  'create or replace function public.forfeit_layaway_ledger(p_ledger_id uuid)',
);
const rpcEnd = SQL.indexOf(
  'comment on function public.forfeit_layaway_ledger(uuid)',
  rpcStart,
);
const RPC = SQL.slice(rpcStart, rpcEnd);

describe('migration 20260921120000 — controlled Layaway Ledger forfeiture', () => {
  it('preflights every live-only dependency and reports dirty code-pool assignments', () => {
    expect(SQL).toContain('missing dependencies');
    for (const dependency of [
      'layaway_ledger',
      'layaway_ledger_items',
      'layaway_arrangements',
      'layaway_code_pool',
      'inventory_items',
      'inventory_reservations',
      'official_orders',
      'official_order_claims',
      'returned_to_stock_reviews',
      'owner_approval_requests',
      'audit_events',
    ]) {
      expect(SQL).toContain(`('${dependency}',`);
    }
    expect(SQL).toContain("to_regprocedure('app_private.is_owner()')");
    expect(SQL).toContain("to_regprocedure('app_private.current_staff_id()')");
    expect(SQL).toContain('group by lower(btrim(code))');
    expect(SQL).toContain('layaway code pool has duplicate normalized codes');
    expect(SQL).toContain('layaway code pool has refs holding more than one active code');
    expect(SQL).toContain(
      'open layaway ledger code assignments do not match their historical codes',
    );
    expect(SQL).toContain("p.ref = 'ledger:' || l.id::text");
    expect(SQL).toContain(
      'lower(btrim(p.code)) is distinct from lower(btrim(l.layaway_code))',
    );
    for (const inventoryColumn of [
      'quantity_total',
      'facebook_name',
      'custody_holder',
      'custody_handler_id',
      'custody_updated_at',
      'custody_updated_by',
    ]) {
      expect(SQL).toContain(`('inventory_items', '${inventoryColumn}')`);
    }
    expect(SQL.indexOf('$preflight$;')).toBeLessThan(
      SQL.indexOf('create unique index if not exists layaway_code_pool_code_ci_uidx'),
    );
  });

  it('post-checks named code-pool indexes instead of trusting IF NOT EXISTS', () => {
    expect(SQL).toContain('do $index_guard$');
    expect(SQL).toContain('idx.indisunique');
    expect(SQL).toContain('idx.indisvalid');
    expect(SQL).toContain('idx.indisready');
    expect(SQL).toContain('pg_get_indexdef(idx.indexrelid, 1, true)');
    expect(SQL).toContain("<> 'lower(btrim(code))'");
    expect(SQL).toContain("<> 'refisnotnull'");
    expect(SQL).toContain(
      'layaway_code_pool_code_ci_uidx exists but does not enforce unique',
    );
    expect(SQL).toContain(
      'layaway_code_pool_ref_uidx exists but does not enforce one non-null active code per ref',
    );
  });

  it('is an Owner-only, pinned SECURITY DEFINER RPC with narrow grants', () => {
    expect(RPC).toContain("security definer set search_path = ''");
    expect(RPC).toContain('if not app_private.is_owner() then');
    expect(RPC).toContain('v_actor_auth uuid := (select auth.uid())');
    expect(RPC).toContain('v_staff := app_private.current_staff_id()');
    expect(SQL).toContain(
      'revoke all on function public.forfeit_layaway_ledger(uuid) from public, anon',
    );
    expect(SQL).toContain(
      'grant execute on function public.forfeit_layaway_ledger(uuid) to authenticated, service_role',
    );
  });

  it('serializes on the ledger and makes an already-forfeited retry a no-op', () => {
    expect(RPC).toMatch(
      /select \* into v_ledger from public\.layaway_ledger where id = p_ledger_id for update/,
    );
    expect(RPC).toContain("if lower(coalesce(v_ledger.status, '')) = 'forfeited' then");
    expect(RPC).toContain("'deduplicated', true");
    expect(RPC).toContain("'changed', false");
    expect(RPC.indexOf("'deduplicated', true")).toBeLessThan(
      RPC.indexOf('insert into public.returned_to_stock_reviews'),
    );
  });

  it('resolves direct, multi-item and converted-order links, then locks deterministically', () => {
    expect(RPC).toContain('select v_ledger.inventory_item_id as inventory_item_id union');
    expect(RPC).toContain(
      'select li.inventory_item_id from public.layaway_ledger_items li where li.ledger_id = p_ledger_id union',
    );
    expect(RPC).toContain(
      'join public.official_order_claims ooc on ooc.official_order_id = o.id join public.claims c on c.id = ooc.claim_id where o.converted_layaway_ledger_id = p_ledger_id',
    );
    expect(RPC).toMatch(
      /from public\.official_orders o where o\.id = any\(v_order_ids\) order by o\.id for update/,
    );
    expect(RPC).toMatch(
      /from public\.inventory_items i where i\.id = any\(v_item_ids\) order by i\.id for update/,
    );
    expect(RPC).toMatch(/order by r\.id for update of r/);
  });

  it('returns only held inventory, treats already-available rows as no-op, and rejects terminal states', () => {
    expect(RPC).toContain(
      "i.availability_status in ('committed', 'provisionally_reserved')",
    );
    expect(RPC).toContain(
      "i.availability_status in ('available', 'returned_to_available')",
    );
    expect(RPC).toContain(
      "i.availability_status in ('completed', 'released', 'sold_released')",
    );
    expect(RPC).toContain('already sold/completed/released and cannot be returned');
    expect(RPC).toContain('is not in a releasable inventory state');
    expect(RPC).toContain('foreach v_item_id in array v_releasable_item_ids loop');
    expect(RPC).not.toContain('foreach v_item_id in array v_item_ids loop');
    expect(RPC).toContain(
      "'already_available_item_ids', to_jsonb(v_already_available_item_ids)",
    );
  });

  it('does not invent a released quantity for ambiguous reservation-less multi-stock', () => {
    expect(RPC).toContain('select i.quantity_total into v_inventory_quantity');
    expect(RPC).toContain('select sum(r.quantity)::int into v_quantity');
    expect(RPC).toContain('if v_inventory_quantity is distinct from 1 then');
    expect(RPC).toContain('its released quantity is ambiguous');
    expect(RPC).toContain(
      'elsif v_inventory_quantity is null or v_inventory_quantity < 1 or v_quantity < 1 or v_quantity > v_inventory_quantity then',
    );
  });

  it("releases only this ledger's reservations and active code assignment", () => {
    expect(RPC).toContain('o.converted_layaway_ledger_id = p_ledger_id and r.state in');
    expect(RPC).toContain("set state = 'released', released_at = now()");
    expect(RPC).toContain('a linked item has another active reservation');
    expect(RPC).toContain("perform pg_advisory_xact_lock(hashtext('layaway_code_pool'))");
    expect(RPC).toContain("where p.ref = 'ledger:' || p_ledger_id::text for update");
    expect(RPC).toContain('layaway code assignment mismatch for ledger');
    expect(RPC).toContain('layaway code assignment is missing for ledger');
    expect(RPC).toContain(
      "where ref = 'ledger:' || p_ledger_id::text and lower(btrim(code)) = lower(btrim(v_ledger.layaway_code))",
    );
    expect(RPC).not.toContain('set layaway_code =');
  });

  it('neutralizes converted orders and claims without deleting their history', () => {
    expect(RPC).toContain("'official_order_cancellation', 'approved', 'official_order'");
    expect(RPC).toContain("set status = 'cancelled'");
    expect(RPC).toContain('cancellation_approval_request_id = v_order_approval_id');
    expect(RPC).toContain("set status = 'withdrawn_confirmed'");
    expect(RPC).toContain('v_withdrawn_claim_ids');
    expect(RPC).not.toContain('delete from public.official_orders');
    expect(RPC).not.toContain('delete from public.claims');
    expect(RPC).not.toContain('delete from public.official_order_claims');
  });

  it('uses attributed approved RTS evidence and never creates or deletes inventory', () => {
    expect(RPC).toContain('insert into public.returned_to_stock_reviews');
    expect(RPC).toContain("'layaway_forfeited_disposition'");
    expect(RPC).toContain("'approved_return'");
    expect(RPC).toContain("'returned_to_available'");
    expect(RPC).toContain("set availability_status = 'available'");
    expect(RPC).not.toContain('insert into public.inventory_items');
    expect(RPC).not.toContain('delete from public.inventory_items');
  });

  it('writes the success audit in the same RPC after the business mutation', () => {
    const ledgerMutation = RPC.indexOf(
      "update public.layaway_ledger set status = 'forfeited'",
    );
    const codeRelease = RPC.lastIndexOf('delete from public.layaway_code_pool');
    const auditInsert = RPC.indexOf('insert into public.audit_events');

    expect(ledgerMutation).toBeGreaterThan(-1);
    expect(codeRelease).toBeGreaterThan(ledgerMutation);
    expect(auditInsert).toBeGreaterThan(codeRelease);
    expect(RPC.match(/insert into public\.audit_events/g)).toHaveLength(1);
    for (const field of [
      'layaway_id',
      'layaway_code',
      'previous_status',
      'new_status',
      'item_unique_codes',
      'released_inventory_items',
      'released_reservation_ids',
      'released_layaway_code_assignments',
    ]) {
      expect(RPC).toContain(`'${field}'`);
    }
  });
});
