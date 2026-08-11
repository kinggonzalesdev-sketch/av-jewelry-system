'use server';

import { revalidatePath } from 'next/cache';

import { getOrderDetail } from '@/lib/orders/detail';
import {
  removeOrderItem,
  splitOrderItem,
  type EditItemResult,
  type SplitItemResult,
} from '@/lib/orders/edit-items';
import {
  markOrderDone,
  transferOrderToCompleted,
  type CompletionResult,
} from '@/lib/orders/completion';
import type { OrderDetailResult } from '@/lib/orders/detail-types';
import {
  transferOrderDestination,
  type TransferDestinationResult,
} from '@/lib/orders/destination';
import {
  advanceOrderConfirmPayment,
  advanceOrderReadyForPreparation,
  advanceOrderToReminder,
  getForInvoiceOrders,
  getOrderInvoiceMessage,
  getCustomerMatchInfo,
  getOrderReminders,
  resendOrderInvoice,
  saveOrderInvoiceMessage,
  sendOrderInvoice,
  sendOrderReminder,
  setCustomerFacebookUrl,
  setCustomerPancakeConversation,
  setOrderFacebookLink,
  setOrderCustomerResponse,
  type BulkInvoiceOrder,
  type ForInvoiceResult,
  type OrderInvoiceMessage,
  type OrderReminder,
} from '@/lib/orders/for-invoice';
import { recordAuditEvent } from '@/lib/audit/log';
import {
  deleteTestOrderAndReturnItems,
  type DeleteTestOrderResult,
} from '@/lib/orders/test-order';
import {
  adminEditOrder,
  deleteCancelledOrder,
  deleteOrder,
  type AdminEditOrderResult,
  type DeleteCancelledOrderResult,
} from '@/lib/orders/cancelled-order';
import {
  finalizeOrderCancellation,
  requestOrderCancellation,
  type CancellationResult,
  type FinalizeCancellationResult,
  rejectOrderCancellation,
} from '@/lib/orders/cancellation';
import {
  captureManualOrder,
  type ManualOrderInput,
  type ManualOrderResult,
} from '@/lib/orders/manual-order';
import {
  addOrderPayment,
  type AddOrderPaymentInput,
  type AddOrderPaymentResult,
} from '@/lib/orders/order-payment';
import {
  getOrderLineItems,
  searchCaptureItems,
  type CaptureItem,
  type OrderLineItem,
} from '@/lib/orders/service';
import {
  completeWalkInOrder,
  createWalkInOrder,
  saveWalkInOrder,
  setOrderWaybill,
  updateInventoryGrams,
  type SaveWalkInInput,
  type SaveWalkInResult,
  type WalkInItemInput,
  type WalkInResult,
} from '@/lib/orders/walkin';

/**
 * New Order actions (transport only). Authority, validation, the multi-item
 * atomic save, and the For-Invoice / Completed rules live in the domain modules
 * and the database.
 */

/**
 * Load an Official Order's line items on demand (for the Order Details drawer).
 * Read-only and RLS-scoped — returns rows only for an order the caller may read.
 */
export async function loadOrderLineItemsAction(
  officialOrderId: string,
): Promise<OrderLineItem[]> {
  if (!officialOrderId) return [];
  return getOrderLineItems(officialOrderId);
}

/**
 * Load one Official Order's full detail bundle for the Order Details modal.
 * Read-only and RLS-scoped — it returns detail only for an order the caller may
 * read, runs no write, and changes no status. Called on open AND after an
 * in-modal action succeeds, so the modal can refresh just this order's data.
 */
export async function loadOrderDetailAction(
  officialOrderId: string,
): Promise<OrderDetailResult> {
  if (!officialOrderId) {
    return { ok: false, reason: 'No order was specified.' };
  }
  return getOrderDetail(officialOrderId);
}

/**
 * Edit Items — SUPER ADMIN (owner) only, re-checked in the DB. Remove a piece
 * (returns it to Active stock, order total drops) or Split it into its own new
 * For-Invoice order. Revalidates Orders + Inventory so the cards, the item list,
 * and Active Inventory all reflect the change.
 */
export async function removeOrderItemAction(
  officialOrderId: string,
  claimId: string,
): Promise<EditItemResult> {
  const result = await removeOrderItem(officialOrderId, claimId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
  }
  return result;
}

export async function splitOrderItemAction(
  officialOrderId: string,
  claimId: string,
): Promise<SplitItemResult> {
  const result = await splitOrderItem(officialOrderId, claimId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
  }
  return result;
}

/** Transfer an order to another section (§6). Guarded in the domain module + DB,
 *  which refuse a transfer to the destination it is ALREADY at and route the
 *  Completed destination through the completion gate. On success the Orders list
 *  revalidates so the status cards move the order immediately. */
export async function transferOrderDestinationAction(
  officialOrderId: string,
  destination: string,
): Promise<TransferDestinationResult> {
  const result = await transferOrderDestination(officialOrderId, destination);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/orders/payments');
  }
  return result;
}

/**
 * Delivery → Done (§5). Records the handover and moves the order to Completed in
 * one transaction, stamping completed by / date / time. The database re-checks
 * that the order is fully paid and actually fulfilled, so a premature Done is
 * refused rather than silently accepted.
 */
export async function markOrderDoneAction(
  officialOrderId: string,
): Promise<CompletionResult> {
  const result = await markOrderDone(officialOrderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/orders/payments');
  }
  return result;
}

/** Transfer to Completed from any eligible active section (§5). Same gate as Done. */
export async function transferOrderToCompletedAction(
  officialOrderId: string,
): Promise<CompletionResult> {
  const result = await transferOrderToCompleted(officialOrderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/orders/payments');
  }
  return result;
}

/**
 * Walk-In sale (Owner decision 2026-07-25). Creates a fully-paid, Completed order
 * and retires the item to Completed inventory in one atomic step. Authority and
 * the whole transactional chain live in the domain module and the database.
 */
/**
 * For-Invoice "Verified" → move the order to For Reminder. Guarded + idempotent in
 * the domain module + DB. On success the Orders list revalidates so the order
 * moves to the For Reminder card without a full-page reload.
 */
export async function verifyForInvoiceAction(
  orderId: string,
  message?: string | null,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderToReminder(orderId, message ?? null);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/**
 * Send Invoice (Owner flow) — deliver the invoice to the customer's Facebook chat
 * WITHOUT advancing the order. It stays in For Invoice; the Admin transfers it to a
 * destination afterwards. Revalidates so the Sent status shows.
 */
export async function sendInvoiceMessageAction(
  orderId: string,
  message?: string | null,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await sendOrderInvoice(orderId, message ?? null);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Orders Workflow: For Reminder → For Confirm (payment-gated in the DB). */
export async function confirmRequiredPaymentAction(
  orderId: string,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderConfirmPayment(orderId);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Orders Workflow: For Confirm → For Prepare (ready for preparation). */
export async function readyForPreparationAction(
  orderId: string,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderReadyForPreparation(orderId);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/**
 * Cancel an order → For Cancel. The order stops and the cancellation goes up for
 * Owner review; the linked inventory stays RESERVED (nothing returns to stock yet).
 * Idempotent, so a repeated click cannot raise a second cancellation.
 */
export async function requestOrderCancellationAction(
  orderId: string,
  reason: string,
): Promise<CancellationResult> {
  const result = await requestOrderCancellation(orderId, reason);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * Finalize a cancellation → Cancelled (Owner / Selected Admin). Returns only stock
 * that was never dispatched, delivered, picked up, sold, released, or forfeited,
 * through the Returned-to-Stock Review the system requires.
 */
export async function finalizeOrderCancellationAction(
  orderId: string,
): Promise<FinalizeCancellationResult> {
  const result = await finalizeOrderCancellation(orderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * Reject a cancellation request (Super Admin) — the order returns to its prior
 * status. Paired with finalize (Accept) to give the one-step Accept / Reject flow.
 */
export async function rejectOrderCancellationAction(
  orderId: string,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rejectOrderCancellation(orderId, note ?? null);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * SUPER ADMIN (Owner) — delete a TEST order and return its item(s) to Active
 * Inventory. Requires typing "DELETE TEST". The domain fn + DB function are the real
 * gate (Owner-only, is_test-only, money-safe: test rows never hit reports).
 */
export async function deleteTestOrderAction(
  orderId: string,
  confirm: string,
): Promise<DeleteTestOrderResult> {
  if (confirm !== 'DELETE TEST') {
    return { ok: false, error: 'Type DELETE TEST to confirm.' };
  }
  const result = await deleteTestOrderAndReturnItems(orderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * SUPER ADMIN (Owner) — delete a CANCELLED order and return any still-reserved item(s)
 * to Active Inventory. Requires typing "DELETE". The domain fn + DB function are the
 * real gate (Owner-only, cancelled-status-only).
 */
export async function deleteCancelledOrderAction(
  orderId: string,
  confirm: string,
): Promise<DeleteCancelledOrderResult> {
  if (confirm !== 'DELETE') {
    return { ok: false, error: 'Type DELETE to confirm.' };
  }
  const result = await deleteCancelledOrder(orderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * SUPER ADMIN (Owner) — delete ANY order (Delete on every row) and return its item(s)
 * to Active Inventory. Requires typing "DELETE". Owner-only in the DB. Destructive:
 * removes the order + all its records including payment history.
 */
export async function deleteOrderAction(
  orderId: string,
  confirm: string,
): Promise<DeleteCancelledOrderResult> {
  if (confirm !== 'DELETE') {
    return { ok: false, error: 'Type DELETE to confirm.' };
  }
  const result = await deleteOrder(orderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * SUPER ADMIN (Owner) — correct an order's Customer Name and/or Total Amount. Owner-only
 * in the DB (admin_edit_order). Money passed as an authoritative string.
 */
export async function adminEditOrderAction(
  orderId: string,
  customerName: string | null,
  totalAmount: string | null,
): Promise<AdminEditOrderResult> {
  const result = await adminEditOrder(orderId, { customerName, totalAmount });
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Load the prepared invoice message for an order ("View Message"). Read-only. */
export async function loadOrderInvoiceMessageAction(
  orderId: string,
): Promise<
  { ok: true; message: OrderInvoiceMessage | null } | { ok: false; error: string }
> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  return getOrderInvoiceMessage(orderId);
}

/** Save an edited invoice message for an order. RLS-gated to message preparation /
 *  sending. Changes no status and touches no money. */
export async function saveOrderInvoiceMessageAction(
  orderId: string,
  customerId: string,
  body: string,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  if (!customerId) return { ok: false, error: 'A customer is required.' };
  return saveOrderInvoiceMessage(orderId, customerId, body);
}

/** Retry Send — re-deliver the invoice via Pancake WITHOUT advancing the order or
 *  creating anything new. */
export async function resendInvoiceAction(orderId: string): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  return resendOrderInvoice(orderId);
}

/** Customer-match ambiguity for the invoice send warning (same name / no conversation). */
export async function getCustomerMatchInfoAction(customerId: string) {
  return getCustomerMatchInfo(customerId);
}

/** Load the For-Invoice orders + their chat eligibility for "Send All Invoices". */
export async function loadForInvoiceOrdersAction(): Promise<BulkInvoiceOrder[]> {
  return getForInvoiceOrders();
}

/** Audit the outcome of a bulk "Send All Invoices" run (per-order sends are each
 *  advanced + audited individually via verifyForInvoiceAction). */
export async function recordBulkInvoiceSendAction(summary: {
  sent: number;
  failed: number;
  skipped: number;
}): Promise<void> {
  await recordAuditEvent({
    action: 'order.bulk_invoice_send',
    entityType: 'official_order',
    context: summary,
  });
  revalidatePath('/orders');
}

/** Load reminders sent + recorded customer response for an order (For Reminder). */
export async function loadOrderRemindersAction(
  orderId: string,
): Promise<{ reminders: OrderReminder[]; customerResponse: string | null }> {
  if (!orderId) return { reminders: [], customerResponse: null };
  return getOrderReminders(orderId);
}

/** Record a reminder (1..3) as sent. Never moves the order. */
export async function sendOrderReminderAction(
  orderId: string,
  reminderNumber: number,
  body: string,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await sendOrderReminder(orderId, reminderNumber, body);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Confirm the customer response and route the order per the mapping. */
export async function setCustomerResponseAction(
  orderId: string,
  responseValue: string,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await setOrderCustomerResponse(orderId, responseValue);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Set a customer's Facebook Messenger URL (Owner/Admin) — powers Open FB Chat. */
export async function setCustomerFacebookUrlAction(
  customerId: string,
  url: string | null,
): Promise<ForInvoiceResult> {
  if (!customerId) return { ok: false, error: 'A customer is required.' };
  const result = await setCustomerFacebookUrl(customerId, url);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Set a customer's Pancake conversation id (Owner/Admin) — powers auto-delivery
 *  of Send Invoice / Send Reminder through Pancake. */
export async function setCustomerPancakeConversationAction(
  customerId: string,
  conversationId: string | null,
): Promise<ForInvoiceResult> {
  if (!customerId) return { ok: false, error: 'A customer is required.' };
  const result = await setCustomerPancakeConversation(customerId, conversationId);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Save (or clear) the confirmed Facebook/Pancake link on ONE order (Owner/Admin). The
 *  transaction keeps its own conversation for Send Invoice / Open FB Chat (spec §6). */
export async function setOrderFacebookLinkAction(
  orderId: string,
  input: {
    conversationId?: string | null;
    url?: string | null;
    pancakeCustomerId?: string | null;
    pageId?: string | null;
    method?: string | null;
    confidence?: string | null;
  },
): Promise<ForInvoiceResult> {
  const result = await setOrderFacebookLink(orderId, input);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Server-side item search for the New Order picker — returns the top available-item
 *  matches for a typed query so the picker never has to load the whole catalogue. */
export async function searchCaptureItemsAction(query: string): Promise<CaptureItem[]> {
  return searchCaptureItems(query, 30);
}

/**
 * Walk-In multi-item sale (transport only). Creates one fully-paid, Completed order
 * with every selected item retired to Completed inventory, atomically in the DB. On
 * success the Orders / Inventory / Payments lists revalidate.
 */
export async function captureWalkInOrderAction(input: {
  customerName: string | null;
  items: WalkInItemInput[];
  paymentMethod: string | null;
  saleDate: string | null;
  /** Admin Name (§2). Re-resolved server-side; a client cannot impersonate. */
  adminId?: string | null;
}): Promise<WalkInResult> {
  const result = await createWalkInOrder(input);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/orders/payments');
  }
  return result;
}

/**
 * Add a payment or Down Payment / Deposit to an order (Order View modal). Validation
 * (amount > 0, ≤ remaining balance) and attribution live in the domain + DB. On
 * success the Orders list + Payments views revalidate so the row, summary cards, and
 * modal refresh without a full reload. Never advances the workflow status.
 */
export async function addOrderPaymentAction(
  input: AddOrderPaymentInput,
): Promise<AddOrderPaymentResult> {
  const result = await addOrderPayment(input);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/payments');
  }
  return result;
}

/**
 * Record the outcome of printing a saved order's label (Owner request — keep a
 * print status, printed-by, date, and time). The audit event captures the acting
 * staff + timestamp automatically, so a reprint or a failed print is traceable.
 * Never touches the order's money or status; a print failure must never undo the
 * saved order.
 */
export async function recordOrderPrintAction(
  officialOrderId: string,
  outcome: 'printed' | 'failed' | 'reprinted',
): Promise<void> {
  if (!officialOrderId) return;
  await recordAuditEvent({
    action: 'order.label_print',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: { outcome },
  });
}

/**
 * New Entry multi-item order (transport only). Saves one parent order with many
 * order-item records directly into For Invoice, atomically in the DB. On success the
 * Orders / Invoice / Inventory lists revalidate so the For Invoice card + count
 * update without a full reload and the items show reserved.
 */
export async function captureManualOrderAction(
  input: ManualOrderInput,
): Promise<ManualOrderResult> {
  const result = await captureManualOrder(input);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/invoice');
    revalidatePath('/orders/inventory');
  }
  return result;
}

/** Save a Walk-In (no auto-complete/print). Revalidates the affected screens. */
export async function saveWalkInOrderAction(
  input: SaveWalkInInput,
): Promise<SaveWalkInResult> {
  const result = await saveWalkInOrder(input);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Transfer a saved Walk-In → Completed (fully-paid gate in the DB). */
export async function completeWalkInOrderAction(
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await completeWalkInOrder(orderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Transfer a saved Walk-In (or any invoiced order) → For Reminder. */
export async function transferWalkInToReminderAction(
  orderId: string,
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderToReminder(orderId);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Edit an inventory item's grams (Walk-In editable grams). Audited in the DB. */
export async function updateInventoryGramsAction(
  itemId: string,
  newGrams: string,
): Promise<{ ok: true; previous: string; next: string } | { ok: false; error: string }> {
  const result = await updateInventoryGrams(itemId, newGrams);
  if (result.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
  }
  return result;
}

/** Set / update the shipping waybill on an order (Ship Confirm). */
export async function setOrderWaybillAction(
  orderId: string,
  waybill: string,
): Promise<{ ok: true; waybill: string } | { ok: false; error: string }> {
  const result = await setOrderWaybill(orderId, waybill);
  if (result.ok) {
    revalidatePath('/orders');
  }
  return result;
}
