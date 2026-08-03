/**
 * Order-detail shapes shared by the server reader (`getOrderDetail`) and the
 * client `OrderDetailsModal`.
 *
 * Kept OUT of any `'server-only'` module so a Client Component can import the
 * types WITHOUT dragging server code into the browser bundle — the same rule the
 * attachments and payment action-state files follow. Everything here is a plain
 * type; `import type` is fully erased at build time.
 *
 * The modal is READ-first: opening it runs no write and changes no status, so it
 * can never create a duplicate or mutate the order. Actions inside reuse the
 * existing, permission-guarded server actions; nothing here re-implements one.
 */

import type { AttachmentRow } from '@/lib/attachments/types';
import type { ApprovalRow, FulfillmentRow } from '@/lib/fulfillment/service';
import type { PayableOrderRow } from '@/lib/payments/workspace';
import type { PaymentStatus } from '@/lib/orders/service';

/** What the caller may DO from inside the modal. Mirrors the server permission
 *  grants exactly (see getGrantedPermissions) so the UI never offers a control
 *  the database then refuses. UI visibility is convenience, never the control. */
export type OrderDetailPermissions = {
  isOwner: boolean;
  /** `payment_verification` — the grant that gates recording a payment (§16). */
  canRecordPayment: boolean;
  canPrepareFulfillment: boolean;
  canReleaseFulfillment: boolean;
  canPrepareInvoice: boolean;
  /** `initiate_high_risk_action` — request an exceptional (Owner-approved) release. */
  canRequestApproval: boolean;
};

export type OrderPaymentHistoryEntry = {
  paymentId: string;
  amount: string;
  verifiedAmount: string | null;
  status: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  recordedAt: string;
  /** The payment/transaction date (when the money moved), for the verify modal. */
  transactedAt: string | null;
  voided: boolean;
  reversed: boolean;
  correctionPending: boolean;
};

export type OrderFulfillmentDetail = {
  status: string;
  collectionChannel: string | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
  collectedAt: string | null;
} | null;

export type OrderLayawayInstallment = {
  number: number;
  dueDate: string;
  amountDue: string;
  paid: boolean;
};

export type OrderLayawayDetail = {
  status: string;
  months: number | null;
  layawayFee: string | null;
  finalDueDate: string | null;
  installments: OrderLayawayInstallment[];
} | null;

export type OrderActivityEntry = {
  id: string;
  action: string;
  actorLabel: string;
  outcome: string;
  reason: string | null;
  occurredAt: string;
};

export type OrderLineItemDetail = {
  claimReference: string;
  itemName: string | null;
  itemCode: string | null;
  gramsPerPiece: string | null;
  quantity: number;
  unitPrice: string | null;
};

export type OrderDetail = {
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string;
  status: string;
  createdAt: string;

  /** For-Prepare routing (Orders Workflow). Null until the order is transferred;
   *  once set it is one-way and the transfer is attributed. */
  fulfillmentDestination: string | null;
  destinationSetAt: string | null;
  destinationSetByName: string | null;

  /** Why this order may NOT be transferred to Completed right now, or null when
   *  it may (§5). Read from `order_completion_block` — the SAME function the
   *  write path enforces — so Done / Transfer to Completed is never offered on an
   *  order the database would refuse, and the reason shown is the real one. */
  completionBlock: string | null;

  /** Shipping waybill / tracking number (Ship Confirm). Null until set. */
  waybillNumber: string | null;

  /** True once "Set Up Layaway" created a layaway account from this order — the
   *  order then leaves the For Layaway card and is tracked in the Layaway ledger. */
  convertedToLayaway: boolean;

  /** Admin Name (§2): who this order is attributed to, and when it was completed.
   *  Completion attribution is null until the order actually completes. */
  adminName: string | null;
  completedAt: string | null;
  completedByName: string | null;

  customer: {
    id: string;
    displayName: string;
    contactNumber: string | null;
    address: string | null;
    /** Stored Facebook Messenger URL for "Open FB Chat" (or null = not available). */
    facebookConversationUrl: string | null;
    /** Pancake conversation id — enables auto-delivery of Send Invoice/Reminder. */
    pancakeConversationId: string | null;
  };

  items: OrderLineItemDetail[];

  /** Authoritative money, all strings. `unavailable` holds the read failure
   *  reason when the balance could not be read — the UI shows that, NEVER a
   *  fabricated ₱0.00 (see getOrderBalance for why zero-on-failure is banned). */
  amounts: {
    unavailable: string | null;
    totalAmountPayable: string;
    /** Verified payments only — the "Paid" figure. Evidence never counts here. */
    verifiedNetPayments: string;
    /** Remaining balance = max(payable − verified, 0). */
    outstandingBalance: string;
    overpaymentCredit: string;
    /** The required down payment (20% of payable) — the gate to advance from
     *  For Reminder to For Confirm. */
    requiredDownPayment: string;
    paidInFull: boolean;
  };

  paymentStatus: PaymentStatus;
  paymentHistory: OrderPaymentHistoryEntry[];

  fulfillment: OrderFulfillmentDetail;
  /** The full fulfillment record for this order (or null), shaped exactly like the
   *  Fulfillment queue rows so the modal can reuse the same guarded action forms. */
  fulfillmentRow: FulfillmentRow | null;
  /** Owner-approval requests tied to THIS order (e.g. exceptional release). */
  approvals: ApprovalRow[];
  layaway: OrderLayawayDetail;

  attachments: AttachmentRow[];
  activity: OrderActivityEntry[];

  permissions: OrderDetailPermissions;

  /** The order shaped for the inline Record Payment form, which reuses the exact
   *  guarded `recordPaymentAction`. Null when the balance could not be read. */
  payable: PayableOrderRow | null;
};

export type OrderDetailResult =
  | { ok: true; detail: OrderDetail }
  | { ok: false; reason: string };
