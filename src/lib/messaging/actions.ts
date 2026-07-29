'use server';

import { revalidatePath } from 'next/cache';

import {
  getTemplateHistory,
  resetMessageTemplate,
  renderOrderMessage,
  saveMessageTemplate,
  type TemplateHistoryEntry,
  type TemplateMutationResult,
} from '@/lib/messaging/templates';
import type { TemplateKey } from '@/lib/messaging/template-vars';

/**
 * Message-template actions (transport only). Every one is Super Admin gated in the
 * domain module AND in the database function beneath it, so calling an action
 * directly is checked identically to using the screen.
 */

export async function saveMessageTemplateAction(
  key: TemplateKey,
  body: string,
): Promise<TemplateMutationResult> {
  const result = await saveMessageTemplate(key, body);
  if (result.ok) revalidatePath('/settings/messages');
  return result;
}

export async function resetMessageTemplateAction(
  key: TemplateKey,
): Promise<TemplateMutationResult> {
  const result = await resetMessageTemplate(key);
  if (result.ok) revalidatePath('/settings/messages');
  return result;
}

export async function loadTemplateHistoryAction(
  key: TemplateKey,
): Promise<TemplateHistoryEntry[]> {
  return getTemplateHistory(key);
}

/**
 * Render a template for a real order — the final message, ready to send.
 *
 * Available to anyone who may work the order (an Admin sends without being able to
 * edit the wording). `missing` lists tokens the order cannot fill, so the caller
 * can BLOCK sending rather than deliver a message with gaps in it.
 */
export async function renderOrderMessageAction(
  officialOrderId: string,
  key: TemplateKey,
): Promise<
  { ok: true; message: string; missing: string[] } | { ok: false; error: string }
> {
  return renderOrderMessage(officialOrderId, key);
}
