'use server';

import { revalidatePath } from 'next/cache';

import {
  DEFAULT_PRIVATE_REPLY_TEXT,
  saveSelectedPancakePage,
  saveSelectedPancakeSender,
  sendPancakeConversationMessage,
  syncPancakeConversationsToCustomers,
} from '@/lib/integrations/pancake';
import {
  runPrivateReplyControlledTest,
  sendControlledTestPhoto,
} from '@/lib/integrations/private-reply-test';
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
 * Primary Super Admin only: run the CONTROLLED Test B private-reply chain for ONE
 * approved test comment. Returns a step-by-step sanitized report (each Pancake
 * request/response). Manual + gated — it does NOT enable the automatic Capture flow.
 */
export type PrivateReplyTestReport = {
  ok: boolean;
  alreadyReplied: boolean;
  report: string;
  /** The resolved REAL conversation id — enables the separate, explicit photo step. */
  realConversationId: string | null;
  aloneVerdict: 'yes' | 'no' | 'cannot_verify';
};

export async function runPrivateReplyTestAction(input: {
  webhookEventId: string;
  message: string;
}): Promise<PrivateReplyTestReport> {
  const webhookEventId = (input.webhookEventId ?? '').trim();
  const message = (input.message ?? '').trim() || DEFAULT_PRIVATE_REPLY_TEXT;
  if (!webhookEventId) {
    return {
      ok: false,
      alreadyReplied: false,
      report: 'Pick a test comment first.',
      realConversationId: null,
      aloneVerdict: 'cannot_verify',
    };
  }
  try {
    const result = await runPrivateReplyControlledTest({ webhookEventId, message });
    const lines = result.steps
      .map((s) => `${s.ok ? '✓' : '✗'} ${s.step}: ${s.detail}`)
      .join('\n');
    const r = result.resolution;
    const summary = [
      '',
      '── Test B (Part 2) summary ──',
      `PRIVATE_REPLY_SEND: ${result.ok ? 'PASS' : result.alreadyReplied ? 'ALREADY_REPLIED' : 'FAIL/STOP'}`,
      `CUSTOMER SENT ANY INBOX MESSAGE AFTER COMMENT: ${r.customerMessagedAfterComment ? 'YES' : 'NO'}`,
      `FOLLOW-UP WEBHOOK WITHOUT CUSTOMER REPLY: ${r.followUpWebhookWithoutCustomerReply ? 'YES' : 'NO'}`,
      `UPDATED COMMENT private_reply_conversation FOUND: ${r.updatedCommentPrivateReplyConversationFound ? 'YES' : 'NO'}`,
      `GET CONVERSATIONS FOUND REAL PRIVATE CONVERSATION: ${r.getConversationsFound ? 'YES' : 'NO'}`,
      `REAL PRIVATE CONVERSATION ID: ${r.realConversationId ? `…${r.realConversationId.slice(-6)}` : 'NONE'}`,
      `SOURCE: ${r.source}`,
      `TIME TO REAL CONVERSATION: ${r.secondsToRealConversation == null ? '—' : `${r.secondsToRealConversation}s`}`,
      `PRIVATE REPLY ALONE CREATES/EXPOSES A MESSAGEABLE CONVERSATION: ${result.privateReplyAloneCreatesConversation.toUpperCase()}`,
      `READY FOR CONTROLLED PHOTO TEST: ${r.realConversationId ? 'YES' : 'NO'}`,
    ].join('\n');
    const header = result.alreadyReplied
      ? 'Test B — ALREADY_REPLIED (not a failure): pick a brand-new, silent-customer comment.'
      : result.ok
        ? 'Test B (Part 2) — private reply sent; bounded resolution attempted (NO photo sent).'
        : 'Test B STOPPED — see the failing step below (exact sanitized Pancake response). No alternate endpoint/action was tried.';
    return {
      ok: result.ok,
      alreadyReplied: result.alreadyReplied,
      report: `${header}\n\n${lines}\n${summary}`,
      realConversationId: result.realPrivateConversationId,
      aloneVerdict: result.privateReplyAloneCreatesConversation,
    };
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return {
        ok: false,
        alreadyReplied: false,
        report: cause.message,
        realConversationId: null,
        aloneVerdict: 'cannot_verify',
      };
    }
    throw cause;
  }
}

/**
 * SEPARATE explicit controlled photo step (Owner click). Sends the Capture screenshot to
 * a RESOLVED REAL inbox conversation id via reply_inbox PHOTO. Never the comment
 * conversation id, never a synthesized {page_id}_{psid}.
 */
export async function sendControlledPhotoAction(input: {
  conversationId: string;
  screenshotCaptureId: string;
}): Promise<{ ok: boolean; report: string }> {
  try {
    const result = await sendControlledTestPhoto(input);
    const lines = result.steps
      .map((s) => `${s.ok ? '✓' : '✗'} ${s.step}: ${s.detail}`)
      .join('\n');
    const header = result.ok
      ? 'Controlled photo sent to the REAL private conversation.'
      : 'Photo step failed — see below.';
    return { ok: result.ok, report: `${header}\n\n${lines}` };
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, report: cause.message };
    throw cause;
  }
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
