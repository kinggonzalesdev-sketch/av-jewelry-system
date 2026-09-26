import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forceDeleteAllowed,
  linkKindLabel,
  linkStateLabel,
  orderHref,
  type ItemDeleteLink,
} from '@/lib/inventory/delete-links';
import { orderIdFromParam } from '@/lib/orders/deep-link';

/**
 * Inventory delete popup — which records link an item, and when the Super Admin may force-delete
 * it (Owner 2026-09-26): "Preserve protection for items linked to any live order, active layaway,
 * payment, or sale. Only cancelled/closed historical links may be ignored for force delete."
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260926120000_inventory_delete_links.sql',
  ),
  'utf8',
);

function fnBody(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return MIGRATION.slice(start, MIGRATION.indexOf('$function$;', start));
}

const link = (over: Partial<ItemDeleteLink>): ItemDeleteLink => ({
  kind: 'order',
  recordId: 'o-1',
  orderId: 'o-1',
  ledgerId: null,
  label: 'MARIA LYZZA · 2026-08-07',
  state: 'cancelled',
  blocks: false,
  reason: null,
  ...over,
});

describe('display helpers', () => {
  it('names each kind of record, including the older list’s kinds', () => {
    expect(linkKindLabel('order')).toBe('Order');
    expect(linkKindLabel('return_review')).toBe('Return review');
    expect(linkKindLabel('rts_review')).toBe('Return review');
    expect(linkKindLabel('layaway')).toBe('Layaway');
    expect(linkKindLabel('something_new')).toBe('Something New');
  });

  it('shows statuses readably', () => {
    expect(linkStateLabel('for_preparation')).toBe('For Preparation');
    expect(linkStateLabel('approved_return')).toBe('Approved Return');
  });

  it('links an order to the Orders page, which opens it', () => {
    expect(orderHref('dc8cfd55-eff2-46a1-8fd7-31cb008b619c')).toBe(
      '/orders?order=dc8cfd55-eff2-46a1-8fd7-31cb008b619c',
    );
  });

  it('offers a force delete only when there are links and every one is closed history', () => {
    expect(
      forceDeleteAllowed([link({}), link({ kind: 'return_review', orderId: null })]),
    ).toBe(true);
    expect(
      forceDeleteAllowed([link({}), link({ state: 'for_preparation', blocks: true })]),
    ).toBe(false);
    expect(forceDeleteAllowed([])).toBe(false);
  });
});

describe('/orders?order=<id>', () => {
  it('accepts only a well-formed order id', () => {
    expect(orderIdFromParam('dc8cfd55-eff2-46a1-8fd7-31cb008b619c')).toBe(
      'dc8cfd55-eff2-46a1-8fd7-31cb008b619c',
    );
    expect(orderIdFromParam('ORD-2026-000145')).toBeNull();
    expect(orderIdFromParam("x' or 1=1")).toBeNull();
    expect(orderIdFromParam(['dc8cfd55-eff2-46a1-8fd7-31cb008b619c'])).toBeNull();
    expect(orderIdFromParam(undefined)).toBeNull();
  });
});

describe('migration 20260926120000 — what protects an item', () => {
  const rows = fnBody('app_private.inventory_item_link_rows');
  const force = fnBody('public.delete_inventory_item_force');
  const list = fnBody('public.inventory_item_delete_links');

  it('a sold item, or one on a live order, hold or return review, is protected', () => {
    expect(rows).toContain(
      "and i.availability_status not in ('available', 'returned_to_available', 'held_unavailable')",
    );
    expect(rows).toContain("then 'The item was sold.'");
  });

  it('any order that is not cancelled protects the item — live orders and completed sales', () => {
    expect(rows).toContain("o.status is distinct from 'cancelled' or pay.n > 0,");
  });

  it('a cancelled order with ANY payment still protects the item', () => {
    expect(rows).toContain(
      'select count(*) as n from public.payments p where p.official_order_id = o.id',
    );
  });

  it('every layaway account protects the item, open or closed (it carries payments)', () => {
    const layaway = rows.slice(
      rows.indexOf("select 'layaway'"),
      rows.indexOf("select 'miner'"),
    );
    expect(layaway).toMatch(/l\.status,\s+true,/);
    expect(layaway).toContain('li.inventory_item_id = p_item_id');
  });

  it('a layaway the item’s ORDER was converted into protects it too (review 2026-09-26)', () => {
    // SAMPLE CODE-SC-01: in stock, its only order is a cancelled converted order, and that
    // order's layaway is forfeited — it holds payment history, so the item stays protected.
    const layaway = rows.slice(
      rows.indexOf("select 'layaway'"),
      rows.indexOf("select 'miner'"),
    );
    expect(layaway).toContain('or l.id in (select o.converted_layaway_ledger_id');
  });

  it('open claims, active holds, open reviews, miner positions, pending captures stay protected', () => {
    expect(rows).toContain(
      "c.status in ('pending_claim', 'in_review', 'confirmed_claim'),",
    );
    expect(rows).toContain("r.state in ('provisional', 'committed'),");
    expect(rows).toContain("rts.status = 'in_review',");
    expect(rows).toMatch(/'queued', true,/);
    expect(rows).toContain("o.id is null or o.status is distinct from 'cancelled',");
    expect(rows).toContain("w.status in ('waitlisted', 'excess'),");
  });

  it('never labels an order by its number or its id', () => {
    expect(rows).not.toMatch(/order_number|invoice_number|o\.id::text/);
    expect(rows).toContain('cust.display_name');
  });

  it('the force delete refuses on the SAME list the popup shows', () => {
    expect(force).toContain('from app_private.inventory_item_link_rows(p_item_id) l');
    expect(force).toContain('where l.blocks');
    expect(list).toContain('from app_private.inventory_item_link_rows(p_item_id) l');
  });

  it('locks the item before checking, and refuses a caller with no staff role', () => {
    expect(force).toContain(
      'perform 1 from public.inventory_items where id = p_item_id for update;',
    );
    expect(force.indexOf('for update')).toBeLessThan(
      force.indexOf('inventory_item_link_rows'),
    );
    expect(force).toContain("app_private.current_staff_role() is distinct from 'owner'");
    expect(list).toContain(
      "coalesce(app_private.current_staff_role(), '') not in ('owner', 'selected_admin')",
    );
  });

  it('never deletes a layaway, a payment, an order, or a miner position', () => {
    expect(force).not.toMatch(
      /delete from public\.(layaway_ledger|payments|official_orders|miner_positions)\b/,
    );
    expect(force).not.toMatch(/\bupdate\s+public\./i);
  });

  it('removes a label’s print attempts before the label, so the cleanup cannot fail', () => {
    expect(force.indexOf('delete from public.print_attempts')).toBeGreaterThan(0);
    expect(force.indexOf('delete from public.print_attempts')).toBeLessThan(
      force.indexOf('delete from public.label_jobs'),
    );
  });

  it('closes the new functions to anon and PUBLIC', () => {
    expect(MIGRATION).toContain(
      'revoke all on function app_private.inventory_item_link_rows(uuid) from public, anon, authenticated;',
    );
    expect(MIGRATION).toContain(
      'revoke all on function public.inventory_item_delete_links(uuid) from public, anon;',
    );
    expect(MIGRATION).toContain(
      'revoke all on function public.delete_inventory_item_force(uuid) from public, anon;',
    );
  });
});

// ---------------------------------------------------------------------------
// Server: reading the list, and the audit trail of a force delete.
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const audit = vi.fn<(entry: Record<string, unknown>) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
    }),
}));
vi.mock('@/lib/audit/log', () => ({
  recordAuditEvent: (entry: Record<string, unknown>) => audit(entry),
}));
vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requireOwner: () => Promise.resolve({ staffProfileId: 'staff-1' }),
  requirePermission: () => Promise.resolve({ staffProfileId: 'staff-1' }),
}));

const dbRow = {
  kind: 'order',
  record_id: 'o-1',
  order_id: 'o-1',
  ledger_id: null,
  label: 'MARIA LYZZA · 2026-08-07',
  state: 'cancelled',
  blocks: false,
  reason: 'Cancelled order with no payment.',
};

beforeEach(() => {
  rpc.mockReset();
  audit.mockClear();
});

describe('getItemDeleteLinks', () => {
  it('maps the database rows', async () => {
    const { getItemDeleteLinks } = await import('@/lib/inventory/archive');
    rpc.mockResolvedValueOnce({ data: [dbRow], error: null });
    expect(await getItemDeleteLinks('item-1')).toEqual({
      ok: true,
      exact: true,
      links: [
        {
          kind: 'order',
          recordId: 'o-1',
          orderId: 'o-1',
          ledgerId: null,
          label: 'MARIA LYZZA · 2026-08-07',
          state: 'cancelled',
          blocks: false,
          reason: 'Cancelled order with no payment.',
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('inventory_item_delete_links', {
      p_item_id: 'item-1',
    });
  });

  it('before the migration, shows the older list (no links, no reasons)', async () => {
    const { getItemDeleteLinks } = await import('@/lib/inventory/archive');
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      })
      .mockResolvedValueOnce({
        data: [
          {
            dependency_kind: 'order',
            reference_label: 'MARIA · 2026-08-07',
            is_active: false,
          },
        ],
        error: null,
      });
    const res = await getItemDeleteLinks('item-1');
    expect(res).toEqual({
      ok: true,
      exact: false,
      links: [
        {
          kind: 'order',
          recordId: null,
          orderId: null,
          ledgerId: null,
          label: 'MARIA · 2026-08-07',
          state: '',
          // The older list cannot tell a sale from closed history: never shown as closed.
          blocks: true,
          reason: null,
        },
      ],
    });
    expect(rpc.mock.calls[1]?.[0]).toBe('inventory_item_dependencies');
  });

  it('reports any other error instead of hiding it behind the older list', async () => {
    const { getItemDeleteLinks } = await import('@/lib/inventory/archive');
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '42501',
        message: 'ERROR: Not authorized: managing inventory is reserved',
      },
    });
    expect(await getItemDeleteLinks('item-1')).toEqual({
      ok: false,
      error: 'Not authorized: managing inventory is reserved',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('forceDeleteInventoryItem — the audit trail', () => {
  it('records which closed history the delete removed, without customer names', async () => {
    const { forceDeleteInventoryItem } = await import('@/lib/inventory/archive');
    rpc
      .mockResolvedValueOnce({ data: [dbRow], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect(await forceDeleteInventoryItem('item-1')).toEqual({ ok: true });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'inventory_item_delete_links',
      'delete_inventory_item_force',
    ]);
    const entry = audit.mock.calls[0]?.[0] as { context: Record<string, unknown> };
    expect(entry.context).toEqual({
      permanent: true,
      forced: true,
      removed_history: [
        { kind: 'order', state: 'cancelled', record_id: 'o-1', order_id: 'o-1' },
      ],
    });
    expect(JSON.stringify(entry)).not.toContain('MARIA');
  });

  it('a refusal from the database is shown and audited as failed', async () => {
    const { forceDeleteInventoryItem } = await import('@/lib/inventory/archive');
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message:
          'This item is still linked to a live order, layaway, payment, hold, or sale, so it cannot be deleted — those records are protected. (Live order.)',
      },
    });
    const res = await forceDeleteInventoryItem('item-1');
    expect(res.ok).toBe(false);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ outcome: 'failed' });
  });
});
