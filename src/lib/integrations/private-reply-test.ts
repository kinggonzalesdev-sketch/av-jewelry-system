import 'server-only';

import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getSelectedPancakeSender,
  sendPancakeConversationMessage,
  sendPancakePrivateReply,
} from '@/lib/integrations/pancake';

/**
 * Controlled Test B harness — the Owner privately replies to ONE approved Facebook
 * Live COMMENT and (optionally) delivers a screenshot, with every Pancake request/
 * response sanitized and returned. It is deliberately MANUAL + Primary-Super-Admin
 * gated and does NOT touch the automatic Capture flow (Phase 2 broad rollout stays
 * off until this passes). It NEVER synthesizes {page_id}_{psid}: the delivery target
 * is the REAL private conversation id Pancake returns from the private reply.
 */

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
/** `data.message` node of a stored webhook payload (where can_reply_privately lives). */
function rawMessage(raw: unknown): Record<string, unknown> | null {
  const data = obj(obj(raw)?.data);
  return obj(data?.message);
}

/** One candidate comment for the Test B picker (safe/masked for display). */
export type PrivateReplyTestCandidate = {
  webhookEventId: string;
  fbName: string;
  commentPreview: string;
  at: string;
  canReplyPrivately: boolean;
};

/**
 * Recent Live/video COMMENT events that CAN be privately replied to (can_reply_privately
 * = true) and carry the full identity (post + comment + psid + comment conversation) —
 * so the Owner can pick their approved test comment. Primary Super Admin only.
 */
export async function listPrivateReplyTestCandidates(): Promise<
  PrivateReplyTestCandidate[]
> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return [];
    throw cause;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select(
      'id, facebook_name, comment_text, received_at, livestream_post_id, comment_id, facebook_psid, conversation_id, raw',
    )
    .in('post_type', ['livestream', 'video'])
    .order('received_at', { ascending: false })
    .limit(40);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows
    .map((r) => {
      const crp = rawMessage(r.raw)?.can_reply_privately === true;
      const complete =
        Boolean(str(r.livestream_post_id)) &&
        Boolean(str(r.comment_id)) &&
        Boolean(str(r.facebook_psid)) &&
        Boolean(str(r.conversation_id));
      return {
        webhookEventId: str(r.id),
        fbName: str(r.facebook_name) || '—',
        commentPreview: str(r.comment_text).slice(0, 48),
        at: str(r.received_at),
        canReplyPrivately: crp,
        _complete: complete,
      };
    })
    .filter((c) => c.canReplyPrivately && c._complete)
    .map(({ _complete, ...c }) => c);
}

export type PrivateReplyTestStep = { step: string; ok: boolean; detail: string };
export type PrivateReplyTestResult = {
  ok: boolean;
  stopped: boolean;
  steps: PrivateReplyTestStep[];
  realPrivateConversationId: string | null;
};

const ATTACHMENT_BUCKET = 'attachments';

/**
 * Run the exact Test B chain for ONE comment: private_replies TEXT (verified contract,
 * selected sender) → capture the sanitized Pancake response → resolve the REAL private
 * conversation id → (optional) upload + reply_inbox PHOTO to that REAL conversation.
 * STOPS and returns the exact sanitized response the moment the private-reply endpoint
 * behaves unexpectedly — it NEVER tries an alternate/undocumented action or endpoint.
 */
export async function runPrivateReplyControlledTest(input: {
  webhookEventId: string;
  message: string;
  /** Optional: a capture_record whose screenshot is used for the PHOTO step. */
  screenshotCaptureId?: string | null;
}): Promise<PrivateReplyTestResult> {
  await requirePrimarySuperAdmin();
  const steps: PrivateReplyTestStep[] = [];
  const stop = (): PrivateReplyTestResult => ({
    ok: false,
    stopped: true,
    steps,
    realPrivateConversationId: null,
  });
  const supabase = await createClient();

  // 0) A sender must be selected (fail-closed).
  const sender = await getSelectedPancakeSender();
  if (!sender) {
    steps.push({ step: 'sender', ok: false, detail: 'No Pancake sender selected.' });
    return stop();
  }
  steps.push({
    step: 'sender',
    ok: true,
    detail: `${sender.userName ?? 'sender'} (…${sender.userId.slice(-4)})`,
  });

  // 1) Load the EXACT comment identity from the stored webhook event.
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select('livestream_post_id, comment_id, facebook_psid, conversation_id, raw')
    .eq('id', input.webhookEventId)
    .maybeSingle();
  if (!data) {
    steps.push({ step: 'identity', ok: false, detail: 'Webhook event not found.' });
    return stop();
  }
  const ev = data as Record<string, unknown>;
  const postId = str(ev.livestream_post_id);
  const messageId = str(ev.comment_id);
  const psid = str(ev.facebook_psid);
  const commentConv = str(ev.conversation_id);
  const complete = Boolean(postId && messageId && psid && commentConv);
  steps.push({
    step: 'identity',
    ok: complete,
    detail: `post…${postId.slice(-4)} · comment…${messageId.slice(-4)} · psid…${psid.slice(-4)} · comment_conv…${commentConv.slice(-4)}`,
  });
  if (!complete) return stop();

  // 2) Gate: can_reply_privately === true, or STOP (no send).
  const crp = rawMessage(ev.raw)?.can_reply_privately === true;
  steps.push({
    step: 'can_reply_privately',
    ok: crp,
    detail: crp ? 'true' : 'not true — private reply NOT attempted (safe stop).',
  });
  if (!crp) return stop();

  // 3) private_replies TEXT (verified contract: from_id=PSID, sender_id=selected user).
  const pr = await sendPancakePrivateReply({
    postId,
    messageId,
    fromId: psid,
    commentConversationId: commentConv,
    message: input.message,
  });
  steps.push({
    step: 'private_replies',
    ok: pr.ok,
    detail: `[${pr.code}] ${pr.message}${pr.debug ? ` · ${pr.debug}` : ''}`,
  });
  // Unexpected endpoint/response → STOP and report the exact sanitized response. Never
  // try an alternate/undocumented action or endpoint.
  if (!pr.ok) return stop();

  // 4) Resolve the REAL private/Inbox conversation id from the response.
  const realConv = pr.privateConversationId;
  steps.push({
    step: 'resolve_private_conversation',
    ok: Boolean(realConv),
    detail: realConv
      ? `real private conversation …${realConv.slice(-6)}`
      : 'No private conversation id in the response — inspect the debug above (may arrive via a follow-up Messaging webhook).',
  });
  if (!realConv) {
    return { ok: false, stopped: true, steps, realPrivateConversationId: null };
  }

  // 5) OPTIONAL PHOTO — existing reply_inbox flow, to the REAL private conversation only.
  if (input.screenshotCaptureId && input.screenshotCaptureId.trim()) {
    const { data: cap } = await supabase
      .from('capture_records')
      .select('screenshot_path')
      .eq('id', input.screenshotCaptureId.trim())
      .maybeSingle();
    const path = str((cap as { screenshot_path?: string } | null)?.screenshot_path);
    if (!path) {
      steps.push({ step: 'photo', ok: false, detail: 'No screenshot on that capture id.' });
      return { ok: false, stopped: true, steps, realPrivateConversationId: realConv };
    }
    const signed = (await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
    const url = signed.data?.signedUrl ?? null;
    const photo = await sendPancakeConversationMessage({
      conversationId: realConv,
      message: '',
      attachmentUrl: url,
    });
    steps.push({
      step: 'photo',
      ok: photo.ok,
      detail: `[${photo.code}] ${photo.message}${photo.debug ? ` · ${photo.debug}` : ''}`,
    });
    return {
      ok: photo.ok,
      stopped: !photo.ok,
      steps,
      realPrivateConversationId: realConv,
    };
  }

  steps.push({
    step: 'photo',
    ok: true,
    detail: 'Skipped — no capture screenshot provided (text private reply verified).',
  });
  return { ok: true, stopped: false, steps, realPrivateConversationId: realConv };
}
