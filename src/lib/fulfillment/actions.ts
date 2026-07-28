'use server';

import type { FulfillmentActionState } from '@/lib/fulfillment/action-state';
import { revalidatePath } from 'next/cache';

import {
  completeFulfillment,
  decideOwnerApproval,
  executeOwnerApproval,
  markDispatchedOrPickedUp,
  prepareFulfillment,
  recordCollection,
  recordRemittance,
  releaseFulfillment,
  requestOwnerApproval,
  setCollectionChannel,
  type OwnerApprovalKind,
} from '@/lib/fulfillment/service';

/**
 * Phase 7 server actions (Bible §18, §22.13–22.14).
 *
 * Transport only. Authority, the release rules, execute-once, and audit all live
 * in the domain module and the database.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function prepareFulfillmentAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  const method = text(formData, 'method');

  if (!orderId) return { error: 'An order is required.', success: null };
  if (method !== 'shipping' && method !== 'pickup') {
    return { error: 'A fulfillment method is required.', success: null };
  }

  const result = await prepareFulfillment(orderId, {
    method,
    courier: text(formData, 'courier'),
    trackingNumber: text(formData, 'trackingNumber'),
    pickupLocation: text(formData, 'pickupLocation'),
    pickupContact: text(formData, 'pickupContact'),
    isCod: formData.get('isCod') === 'on',
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return { error: null, success: 'Prepared. Preparing is not releasing.' };
}

export async function releaseFulfillmentAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  if (!orderId) return { error: 'An order is required.', success: null };

  const result = await releaseFulfillment(orderId, text(formData, 'note') ?? undefined);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return { error: null, success: 'Released. Nothing was dispatched automatically.' };
}

export async function dispatchAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  const kind = text(formData, 'kind');

  if (!orderId) return { error: 'An order is required.', success: null };
  if (kind !== 'dispatched' && kind !== 'picked_up') {
    return { error: 'A dispatch kind is required.', success: null };
  }

  const result = await markDispatchedOrPickedUp(orderId, kind);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return {
    error: null,
    success: kind === 'dispatched' ? 'Marked dispatched.' : 'Marked picked up.',
  };
}

export async function setCollectionChannelAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  const channel = text(formData, 'channel');
  if (!orderId) return { error: 'An order is required.', success: null };
  if (!channel) return { error: 'A collection channel is required.', success: null };

  const result = await setCollectionChannel(orderId, channel);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  revalidatePath('/dashboard');
  return { error: null, success: 'Collection channel set.' };
}

export async function recordCollectionAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  const channel = text(formData, 'channel');
  const amount = text(formData, 'amount');
  if (!orderId) return { error: 'An order is required.', success: null };
  if (!channel) return { error: 'A collection channel is required.', success: null };
  if (!amount) return { error: 'The amount collected is required.', success: null };

  const result = await recordCollection(orderId, { channel, amount });
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  revalidatePath('/dashboard');
  return { error: null, success: 'Collection recorded.' };
}

export async function recordRemittanceAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  if (!orderId) return { error: 'An order is required.', success: null };

  const result = await recordRemittance(orderId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  revalidatePath('/dashboard');
  return { error: null, success: 'Remittance recorded.' };
}

export async function completeFulfillmentAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const orderId = text(formData, 'officialOrderId');
  if (!orderId) return { error: 'An order is required.', success: null };

  const result = await completeFulfillment(orderId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return { error: null, success: 'Fulfillment completed.' };
}

export async function requestApprovalAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const kind = text(formData, 'actionKind');
  const entityType = text(formData, 'entityType');
  const entityId = text(formData, 'entityId');
  const reason = text(formData, 'reason');

  if (!kind || !entityType || !entityId) {
    return { error: 'An approval target is required.', success: null };
  }
  if (!reason) return { error: 'An approval request requires a reason.', success: null };

  const result = await requestOwnerApproval(
    kind as OwnerApprovalKind,
    entityType,
    entityId,
    reason,
  );

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return {
    error: null,
    success: 'Request sent for Owner approval. Requesting executes nothing.',
  };
}

export async function decideApprovalAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const requestId = text(formData, 'requestId');
  const decision = text(formData, 'decision');

  if (!requestId) return { error: 'A request is required.', success: null };
  if (decision !== 'approved' && decision !== 'rejected') {
    return { error: 'A decision is required.', success: null };
  }

  const result = await decideOwnerApproval(
    requestId,
    decision,
    text(formData, 'note') ?? undefined,
  );

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return {
    error: null,
    success:
      decision === 'approved'
        ? 'Approved. Deciding is not executing — execute it separately when ready.'
        : 'Rejected. Nothing was executed.',
  };
}

export async function executeApprovalAction(
  _prev: FulfillmentActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const requestId = text(formData, 'requestId');
  if (!requestId) return { error: 'A request is required.', success: null };

  const result = await executeOwnerApproval(requestId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/fulfillment');
  return {
    error: null,
    success: 'Executed. State was re-validated, and an approval executes exactly once.',
  };
}
