import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { resolveAdminName } from '@/lib/authz/admin-name';
import { createClient } from '@/lib/supabase/server';

/**
 * Layaway New Entry — manual encoding of a layaway account, under the per-gram
 * interest rule.
 *
 * Transport only. `create_layaway_account` does the whole thing in ONE
 * transaction: derive and claim the automatic code from the customer's first
 * letter, resolve/create the customer, lock and consume the inventory item,
 * compute the money, write the account, and record month-1 interest + the opening
 * payment. Nothing is computed here — the money shown back is what SQL stored.
 *
 * Interest is Grams × ₱150 per ACTIVE month. Creation charges MONTH 1 ONLY, so a
 * customer who pays off early never owes months 2 or 3. No Interest stores basis
 * 'zero' and posts nothing.
 */

export type LayawayPricingType = 'fixed' | 'per_gram';
/** 'none' = No Interest; 'per_gram' = Grams × ₱150 per active month. */
export type LayawayInterestType = 'none' | 'per_gram';

export type CreateLayawayInput = {
  customerName: string;
  inventoryItemId: string;
  pricingType: LayawayPricingType;
  /** Fixed amount, or the per-gram PRICE (not the interest rate). String money. */
  price: string;
  interestType: LayawayInterestType;
  /** 1, 2 or 3 months. */
  term: number;
  datePurchased: string | null;
  /** Remarks / Financer. */
  remarks: string | null;
  /** Opening payment; '' or '0' means none. */
  payment: string | null;
  modeOfPayment: string | null;
  /** Admin Name — re-resolved server-side; a client cannot impersonate. */
  adminId?: string | null;
};

export type CreateLayawayResult =
  | {
      ok: true;
      ledgerId: string;
      accountNo: string;
      /** The code the SERVER actually assigned (may differ from the preview if
       *  another save took it first). */
      layawayCode: string | null;
      letter: string | null;
      itemCode: string;
      grams: string;
      itemAmount: string;
      /** Grams × ₱150 — the amount charged EACH active month. */
      monthlyInterest: string;
      /** Interest charged so far (month 1 at creation). */
      interest: string;
      grandTotal: string;
      payment: string;
      balance: string;
      status: string;
    }
  | { ok: false; error: string };

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

function str(v: unknown): string {
  return typeof v === 'number' || typeof v === 'string' ? String(v) : '0';
}

/** The letter a name maps to (first A–Z, uppercased). Mirrors the SQL rule so
 *  the form can show the same letter the server will use. */
export function layawayLetterForName(name: string): string | null {
  const m = (name ?? '').toUpperCase().match(/[A-Z]/);
  return m ? m[0] : null;
}

export async function createLayawayAccount(
  input: CreateLayawayInput,
): Promise<CreateLayawayResult> {
  // Client-side mirrors of the DB rules, for immediate feedback. The database
  // re-checks every one of them; these never decide anything on their own.
  const name = (input.customerName ?? '').trim();
  if (!name) return { ok: false, error: 'Enter the customer name.' };
  if (!layawayLetterForName(name)) {
    return {
      ok: false,
      error: 'The customer name has no letter to derive a layaway code from.',
    };
  }
  if (!input.inventoryItemId) {
    return { ok: false, error: 'Select an item from Active Inventory.' };
  }
  const price = (input.price ?? '').trim();
  if (!PRICE_RE.test(price) || Number(price) <= 0) {
    return { ok: false, error: 'Enter a price greater than zero.' };
  }
  if (![1, 2, 3].includes(input.term)) {
    return { ok: false, error: 'Choose a term of 1, 2 or 3 months.' };
  }
  const payment = (input.payment ?? '').trim();
  if (payment && !PRICE_RE.test(payment)) {
    return { ok: false, error: 'Enter a valid payment amount.' };
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('create_layaway_account', {
    p_customer_name: name,
    p_inventory_item_id: input.inventoryItemId,
    p_pricing_type: input.pricingType,
    p_price: price,
    p_interest_type: input.interestType,
    p_term: input.term,
    p_date_purchased: input.datePurchased || null,
    p_remarks: input.remarks?.trim() || null,
    p_payment: payment || '0',
    p_mode_of_payment: input.modeOfPayment?.trim() || null,
    p_admin_id: await resolveAdminName(input.adminId ?? null),
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    const error = res.error.message.replace(/^ERROR:\s*/i, '').trim();
    await recordAuditEvent({
      action: 'layaway.create_account',
      entityType: 'layaway_ledger',
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  const d = res.data ?? {};
  const ledgerId = typeof d.ledger_id === 'string' ? d.ledger_id : '';

  await recordAuditEvent({
    action: 'layaway.create_account',
    entityType: 'layaway_ledger',
    ...(ledgerId ? { entityId: ledgerId } : {}),
    context: {
      account_no: str(d.account_no),
      grand_total: str(d.grand_total),
      interest_type: input.interestType,
      term: input.term,
    },
  });

  return {
    ok: true,
    ledgerId,
    accountNo: str(d.account_no),
    layawayCode: typeof d.layaway_code === 'string' ? d.layaway_code : null,
    letter: typeof d.letter === 'string' ? d.letter : null,
    itemCode: str(d.item_code),
    grams: str(d.grams),
    itemAmount: str(d.item_amount),
    monthlyInterest: str(d.monthly_interest),
    interest: str(d.interest),
    grandTotal: str(d.grand_total),
    payment: str(d.payment),
    balance: str(d.balance),
    status: str(d.status),
  };
}

/**
 * A source layaway record for "Add Info" — the fixed customer + item + stored money
 * that a new record is cloned from. Read-only inputs; the new record edits only the
 * financial details.
 */
export type LayawaySourceRow = {
  ledgerId: string;
  accountNo: string;
  customerName: string;
  layawayCode: string | null;
  status: string;
  itemCode: string | null;
  itemName: string | null;
  grams: string | null;
  itemAmount: string;
  datePurchased: string | null;
};

/** Existing layaway records that can seed an Add Info entry (those with a real item
 *  amount to reuse). Read-only; creates nothing. */
export async function listLayawaySources(limit = 500): Promise<LayawaySourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layaway_ledger')
    .select(
      `id, account_no, customer_name, layaway_code, status, grams, item_amount, date_purchased,
       inventory_items ( item_code, item_name )`,
    )
    .gt('item_amount', 0)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const item = Array.isArray(r.inventory_items)
      ? (r.inventory_items[0] as Record<string, unknown> | undefined)
      : (r.inventory_items as Record<string, unknown> | undefined);
    return {
      ledgerId: r.id as string,
      accountNo: str(r.account_no),
      customerName: str(r.customer_name),
      layawayCode: typeof r.layaway_code === 'string' ? r.layaway_code : null,
      status: str(r.status),
      itemCode: (item?.item_code as string | undefined) ?? null,
      itemName: (item?.item_name as string | undefined) ?? null,
      grams: r.grams !== null && r.grams !== undefined ? str(r.grams) : null,
      itemAmount: str(r.item_amount),
      datePurchased: (r.date_purchased as string | null) ?? null,
    };
  });
}

export type AddLayawayInfoInput = {
  sourceLedgerId: string;
  interestType: LayawayInterestType;
  term: number;
  remarks: string | null;
  payment: string | null;
  modeOfPayment: string | null;
  reference?: string | null;
  adminId?: string | null;
};

/**
 * Add Info — create an ADDITIONAL layaway record from an existing source record,
 * reusing its permanent customer + item and stored item amount, editing only the
 * financial details. Transport only: `add_layaway_info` does the whole transaction
 * (automatic code, month-1 interest, installments, opening payment) and never
 * re-consumes inventory or mutates the source.
 */
export async function addLayawayInfo(
  input: AddLayawayInfoInput,
): Promise<CreateLayawayResult> {
  if (!input.sourceLedgerId) {
    return { ok: false, error: 'Select a source layaway record.' };
  }
  if (![1, 2, 3].includes(input.term)) {
    return { ok: false, error: 'Choose a term of 1, 2 or 3 months.' };
  }
  const payment = (input.payment ?? '').trim();
  if (payment && !PRICE_RE.test(payment)) {
    return { ok: false, error: 'Enter a valid payment amount.' };
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('add_layaway_info', {
    p_source_ledger_id: input.sourceLedgerId,
    p_interest_type: input.interestType,
    p_term: input.term,
    p_remarks: input.remarks?.trim() || null,
    p_payment: payment || '0',
    p_mode_of_payment: input.modeOfPayment?.trim() || null,
    p_reference: input.reference?.trim() || null,
    p_admin_id: await resolveAdminName(input.adminId ?? null),
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    const error = res.error.message.replace(/^ERROR:\s*/i, '').trim();
    await recordAuditEvent({
      action: 'layaway.add_info',
      entityType: 'layaway_ledger',
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  const d = res.data ?? {};
  const ledgerId = typeof d.ledger_id === 'string' ? d.ledger_id : '';
  await recordAuditEvent({
    action: 'layaway.add_info',
    entityType: 'layaway_ledger',
    ...(ledgerId ? { entityId: ledgerId } : {}),
    context: {
      source_action: 'add_info',
      source_ledger_id: input.sourceLedgerId,
      account_no: str(d.account_no),
      grand_total: str(d.grand_total),
      interest_type: input.interestType,
      term: input.term,
    },
  });

  return {
    ok: true,
    ledgerId,
    accountNo: str(d.account_no),
    layawayCode: typeof d.layaway_code === 'string' ? d.layaway_code : null,
    letter: typeof d.letter === 'string' ? d.letter : null,
    itemCode: str(d.item_code),
    grams: str(d.grams),
    itemAmount: str(d.item_amount),
    monthlyInterest: str(d.monthly_interest),
    interest: str(d.interest),
    grandTotal: str(d.grand_total),
    payment: str(d.payment),
    balance: str(d.balance),
    status: str(d.status),
  };
}

export type CreateLayawayFromOrderInput = {
  orderId: string;
  interestType: LayawayInterestType;
  term: number;
  remarks: string | null;
  payment: string | null;
  modeOfPayment: string | null;
  reference?: string | null;
  adminId?: string | null;
};

/**
 * Set Up Layaway from a For-Layaway order — create a layaway ledger account from the
 * order's customer + total amount + total grams, editing only the financial details.
 * Transport only; `create_layaway_from_order` does the whole transaction and never
 * modifies the order or inventory (the items already sit on the order).
 */
export async function createLayawayFromOrder(
  input: CreateLayawayFromOrderInput,
): Promise<CreateLayawayResult> {
  if (!input.orderId) return { ok: false, error: 'An order is required.' };
  if (![1, 2, 3].includes(input.term)) {
    return { ok: false, error: 'Choose a term of 1, 2 or 3 months.' };
  }
  const payment = (input.payment ?? '').trim();
  if (payment && !PRICE_RE.test(payment)) {
    return { ok: false, error: 'Enter a valid payment amount.' };
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('create_layaway_from_order', {
    p_order_id: input.orderId,
    p_interest_type: input.interestType,
    p_term: input.term,
    p_remarks: input.remarks?.trim() || null,
    p_payment: payment || '0',
    p_mode_of_payment: input.modeOfPayment?.trim() || null,
    p_reference: input.reference?.trim() || null,
    p_admin_id: await resolveAdminName(input.adminId ?? null),
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    const error = res.error.message.replace(/^ERROR:\s*/i, '').trim();
    await recordAuditEvent({
      action: 'layaway.from_order',
      entityType: 'official_order',
      ...(input.orderId ? { entityId: input.orderId } : {}),
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  const d = res.data ?? {};
  const ledgerId = typeof d.ledger_id === 'string' ? d.ledger_id : '';
  await recordAuditEvent({
    action: 'layaway.from_order',
    entityType: 'official_order',
    entityId: input.orderId,
    context: {
      ledger_id: ledgerId,
      account_no: str(d.account_no),
      grand_total: str(d.grand_total),
      interest_type: input.interestType,
      term: input.term,
    },
  });

  return {
    ok: true,
    ledgerId,
    accountNo: str(d.account_no),
    layawayCode: typeof d.layaway_code === 'string' ? d.layaway_code : null,
    letter: typeof d.letter === 'string' ? d.letter : null,
    itemCode: str(d.order_number),
    grams: str(d.grams),
    itemAmount: str(d.item_amount),
    monthlyInterest: str(d.monthly_interest),
    interest: str(d.interest),
    grandTotal: str(d.grand_total),
    payment: str(d.payment),
    balance: str(d.balance),
    status: str(d.status),
  };
}

/**
 * The code the server WOULD assign for a name right now — used by the form to
 * show "Assigned Layaway Code" as the operator types. Reserves nothing.
 */
export async function previewLayawayCode(
  customerName: string,
): Promise<{ letter: string | null; code: string | null }> {
  const supabase = await createClient();
  const res = (await supabase.rpc('preview_layaway_code', {
    p_customer_name: customerName,
  })) as { data: { letter: string | null; code: string | null } | null; error: unknown };

  return { letter: res.data?.letter ?? null, code: res.data?.code ?? null };
}
