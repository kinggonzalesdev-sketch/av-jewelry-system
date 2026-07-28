'use server';

import { revalidatePath } from 'next/cache';

import { getOrderDetail } from '@/lib/orders/detail';
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
  getOrderReminders,
  saveOrderInvoiceMessage,
  sendOrderReminder,
  setCustomerFacebookUrl,
  setOrderCustomerResponse,
  type BulkInvoiceOrder,
  type ForInvoiceResult,
  type OrderInvoiceMessage,
  type OrderReminder,
} from '@/lib/orders/for-invoice';
import { recordAuditEvent } from '@/lib/audit/log';
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
import { getOrderLineItems, type OrderLineItem } from '@/lib/orders/service';
import {
  createWalkInOrder,
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

/** Transfer a For-Prepare order to a fulfillment destination (For Prepare
 *  workflow). Guarded + one-way-once in the domain module + DB. On success the
 *  Orders list revalidates so the status cards move the order immediately. */
export async function transferOrderDestinationAction(
  officialOrderId: string,
  destination: string,
): Promise<TransferDestinationResult> {
  const result = await transferOrderDestination(officialOrderId, destination);
  if (result.ok) revalidatePath('/orders');
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
export async function verifyForInvoiceAction(orderId: string): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderToReminder(orderId);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Orders Workflow: For Reminder → For Confirm (payment-gated in the DB). */
export async function confirmRequiredPaymentAction(orderId: string): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderConfirmPayment(orderId);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Orders Workflow: For Confirm → For Prepare (ready for preparation). */
export async function readyForPreparationAction(orderId: string): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const result = await advanceOrderReadyForPreparation(orderId);
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** Load the prepared invoice message for an order ("View Message"). Read-only. */
export async function loadOrderInvoiceMessageAction(
  orderId: string,
): Promise<{ ok: true; message: OrderInvoiceMessage | null } | { ok: false; error: string }> {
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
