import type { LayawayRow } from '@/lib/payments/workspace';
import type { LayawayLedgerRow } from '@/lib/payments/layaway-ledger';

/**
 * ONE unified shape for every Layaway Accounts row — order-derived arrangements and
 * imported ledger accounts alike — so sections, the financer filter, the summary and the
 * table all classify them identically. Extracted from payments-workspace.tsx so the SERVER
 * page reader (listLayawayPage) can build the exact same rows the client used to build in the
 * browser: the mapping is the single source of truth for both.
 *
 * FINANCIAL TRUTH IS NEVER COMPUTED HERE. Every peso figure arrives already decided (stored
 * ledger columns, or the order_balance()/order_item_total() SQL functions) and is carried as a
 * string — a float would round a centavo off a balance that decides whether a customer owes.
 */
export type LayawayAccountRow = {
  key: string;
  /** Reusable short code (A1–Z200) for active accounts; '—' once released. */
  code: string | null;
  customerName: string;
  status: string;
  remarks: string | null;
  /** Layaway financer (order-derived rows); null for imported ledger rows. */
  financer: string | null;
  /** First upcoming installment due date. Kept for the OVERDUE calculation, the
   *  View modal, reminders, and the Dashboard — it is no longer a table column. */
  nextDueDate: string | null;
  /** When the account actually closed out (derived: completedAt; ledger: last payment). */
  completionDate: string | null;
  datePurchased: string | null;
  item: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  accountNo: string;
  /** Linked inventory Unique Code(s); null → "Not linked". */
  uniqueCode: string | null;
  /** Row origin for imported ledger rows ('imported' | 'manual'); null for order-derived
   *  rows. Drives the "Imported (no item)" label instead of a scary "Not linked". */
  sourceKind: string | null;
  /** Facebook Messenger URL for a quick "Open Chat" button (or null). */
  facebookUrl: string | null;
  balanceMismatch: boolean;
  officialOrderId: string | null;
  layawayRow: LayawayRow | null;
  /** Set only for imported ledger rows — the id used to delete them. */
  ledgerId: string | null;
};

/** Order-derived arrangement → unified account row. */
export function fromDerived(l: LayawayRow): LayawayAccountRow {
  return {
    key: `d-${l.layawayId}`,
    code: l.code,
    customerName: l.customerDisplayName,
    status: l.status,
    remarks: l.remarks,
    financer: l.financer,
    nextDueDate: l.finalDueDate,
    completionDate: l.completedAt ? l.completedAt.slice(0, 10) : null,
    datePurchased: l.datePurchased ? l.datePurchased.slice(0, 10) : null,
    item: l.itemAmount,
    interest: l.layawayFee,
    grandTotal: l.totalAmountPayable,
    payment: l.verifiedNetPayments,
    balance: l.outstandingBalance,
    accountNo: l.orderNumber,
    uniqueCode: l.uniqueCode,
    sourceKind: null,
    facebookUrl: l.facebookUrl,
    balanceMismatch: false,
    officialOrderId: l.officialOrderId,
    layawayRow: l,
    ledgerId: null,
  };
}

/** Imported / manual ledger account → unified account row. */
export function fromLedger(l: LayawayLedgerRow): LayawayAccountRow {
  return {
    key: `l-${l.id}`,
    code: l.code,
    customerName: l.customerName,
    status: l.status,
    remarks: l.remarks,
    financer: null,
    nextDueDate: l.nextDueDate,
    completionDate: l.lastPaymentDate,
    datePurchased: l.datePurchased,
    item: l.itemAmount,
    interest: l.interest,
    grandTotal: l.grandTotal,
    payment: l.payment,
    balance: l.balance,
    accountNo: l.accountNo,
    uniqueCode: l.uniqueCode,
    sourceKind: l.sourceKind,
    facebookUrl: l.facebookUrl,
    balanceMismatch: l.balanceMismatch,
    officialOrderId: null,
    layawayRow: null,
    ledgerId: l.id,
  };
}

/** Case- and spacing-insensitive financer key so "nez", "NEZ", and "Nez  " are ONE financer.
 *  Must stay 1:1 with the SQL `lower(regexp_replace(financer_of, '\s+', ' ', 'g'))` the
 *  layaway_page RPC filters on, so a selected dropdown key matches the server exactly. */
export function financerKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Unique-Code cell label: the linked item code, else a legacy-aware placeholder.
 *  Imported balance-only accounts never carried an item Unique Code, so we say
 *  "Imported (no item)" rather than "Not linked" (which reads like a broken link). */
export function uniqueCodeLabel(r: LayawayAccountRow): string {
  if (r.uniqueCode) {
    // A multi-item account resolves to several codes ("CODE1, CODE2, CODE3"). Show only the
    // FIRST in the column so it stays readable — with a "+N" hint that more exist. The full
    // list still lives in `r.uniqueCode` for SEARCH and in the cell's title tooltip.
    const codes = r.uniqueCode.split(/,\s*/).filter(Boolean);
    return codes.length > 1 ? `${codes[0]} +${codes.length - 1}` : r.uniqueCode;
  }
  return r.sourceKind === 'imported' ? 'Imported (no item)' : 'Not linked';
}
