'use server';

import { revalidatePath } from 'next/cache';

import {
  saveSelectedPancakePage,
  saveSelectedPancakeSender,
  sendPancakeConversationMessage,
  syncPancakeConversationsToCustomers,
} from '@/lib/integrations/pancake';
import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import type { IntegrationActionState } from '@/lib/integrations/action-state';

/** Integration server actions. Transport only — authority (Owner) and the real
 *  connection attempt live in the domain module. */

/**
 * Primary Super Admin only: save the selected managed Page. Stores the (non-secret)
 * Page ID with an audit trail — never a token. The Page ID / name / platform come
 * from the Pages the server itself loaded, so nothing sensitive is trusted from the
 * client beyond the choice of which Page.
 */
export async function saveSelectedPageAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const field = (key: string): string => {
    const v = formData.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  const pageId = field('pageId');
  const pageName = field('pageName') || null;
  const platform = field('platform') || null;

  const result = await saveSelectedPancakePage({ pageId, pageName, platform });
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/integrations');
  return { error: null, success: result.message };
}

/**
 * Primary Super Admin only: save the EXPLICITLY-CHOSEN Pancake Private Reply sender —
 * an active Pancake user id (users[].id from Get Users List). The domain layer
 * re-validates the id against the Page's ACTIVE users before storing it, so a
 * disabled/absent user can never become the sender. Never a token; the choice of
 * which user is all that is trusted from the client.
 */
export async function saveSelectedSenderAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const field = (key: string): string => {
    const v = formData.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  const userId = field('userId');
  const userName = field('userName') || null;

  const result = await saveSelectedPancakeSender({ userId, userName });
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/integrations');
  return {
    error: null,
    success: `Private Reply sender saved (Pancake user ${result.userId}).`,
  };
}

/**
 * Primary Super Admin only: send a REAL test message to a Pancake conversation, to
 * verify the send pipeline end-to-end from the browser (no mobile app needed).
 * Requires an explicit conversation id — never sends by Facebook name.
 */
export async function sendPancakeTestAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError)
      return { error: cause.message, success: null };
    throw cause;
  }

  const field = (key: string): string => {
    const v = formData.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  const conversationId = field('conversationId');
  const message = field('message') || 'MineFlow test message ✅';
  if (!conversationId) {
    return { error: 'Enter a Pancake conversation id to send a test.', success: null };
  }

  return sendTestInner(conversationId, message);
}

/**
 * Primary Super Admin only: auto-link Pancake conversations to customers by name,
 * filling each customer's Pancake conversation id so Send Invoice / Reminder can
 * auto-deliver without any manual entry.
 */
export async function syncPancakeConversationsAction(
  _prev: IntegrationActionState,
  _formData: FormData,
): Promise<IntegrationActionState> {
  const result = await syncPancakeConversationsToCustomers();
  if (result.ok) revalidatePath('/orders');
  return result.ok
    ? { error: null, success: result.message }
    : { error: result.message, success: null };
}

async function sendTestInner(
  conversationId: string,
  message: string,
): Promise<IntegrationActionState> {
  const result = await sendPancakeConversationMessage({ conversationId, message });
  // The raw Pancake response is shown so the exact send contract can be verified.
  const debug = result.debug ? `\n\nPancake response: ${result.debug}` : '';
  return result.ok
    ? {
        error: null,
        success:
          `${result.message}` +
          (result.pancakeMessageId ? ` (message id ${result.pancakeMessageId})` : '') +
          debug,
      }
    : { error: `${result.message} [${result.code}]${debug}`, success: null };
}
