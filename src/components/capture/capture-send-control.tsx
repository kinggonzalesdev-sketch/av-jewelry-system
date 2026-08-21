'use client';

import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The per-row screenshot-delivery control in Incoming Captures (Owner request 2026-08-20).
 *
 * A screenshot PHOTO can only be auto/normal-sent when the customer has a genuine, recent Inbox
 * DM ("Photo ready"). A silent/comment-only/outside-24h customer ("Photo waiting") has NO
 * supported PHOTO route — the normal reply_inbox PHOTO would be rejected by Facebook — so we must
 * NOT offer a doomed Send. This control renders exactly one thing per state, driven by the
 * already-computed `photoEligible` (never recomputed here — no duplicated eligibility logic):
 *
 *   Link sent (Route B)        → 🔗 Link sent   (a secure-link Private Reply already went out; NEVER resend)
 *   Photo ready               → 📨 Send        (the manual backup/retry; eligible normally auto-sends)
 *   Photo waiting             → 🔗 Send link   (Route B: TEXT Private Reply with a secure /m link — the
 *                                               same handler; NEVER a doomed reply_inbox PHOTO) + 💬 Open
 *                                               FB Chat when a chat URL exists (the Route C human fallback)
 *   Test capture               → 📨 Send disabled (a test must never message a real customer)
 *
 * The Send entry point stays ready to host a future verified silent-commenter PHOTO route: when
 * one exists, `photoEligible` simply becomes true for that state and Send lights up — no UI rework.
 */
export function CaptureSendControl({
  captureRecordId,
  photoEligible,
  fbUrl,
  isTest,
  sending,
  onSend,
  linkSent = false,
}: {
  captureRecordId: string;
  photoEligible: boolean;
  fbUrl: string | null;
  isTest: boolean;
  sending: boolean;
  onSend: () => void;
  /** Route B already sent a secure-link Private Reply for this capture (message_status
   *  'link_sent') — show a done state and never offer a second send. */
  linkSent?: boolean;
}) {
  // A Test capture never messages a real customer — keep Send visible but disabled.
  if (isTest) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        data-testid={`incoming-send-${captureRecordId}`}
      >
        📨 Send
      </Button>
    );
  }

  // Route B secure-link Private Reply already sent — terminal, never resend (one reply per comment).
  if (linkSent) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        data-testid={`incoming-linksent-${captureRecordId}`}
        title="A secure screenshot link was sent to the customer via a Pancake Private Reply — not resent."
      >
        🔗 Link sent
      </Button>
    );
  }

  // Photo ready — the eligible customer already has an open Inbox window, so the normal
  // reply_inbox PHOTO can be delivered. This is the backup/retry click (auto-send handles most).
  if (photoEligible) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={sending}
        onClick={onSend}
        data-testid={`incoming-send-${captureRecordId}`}
      >
        {sending ? 'Sending…' : '📨 Send'}
      </Button>
    );
  }

  // Photo waiting — no NORMAL Inbox PHOTO route. Offer the Route B secure-link Private Reply
  // ("Send link" → the SAME onSend handler, which routes to a TEXT Private Reply carrying a secure
  // /m link, NEVER a doomed reply_inbox PHOTO; the auto path also attempts this — this is the manual
  // trigger / retry). Open FB Chat stays as the human Route C fallback when a chat URL exists.
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={sending}
        onClick={onSend}
        data-testid={`incoming-sendlink-${captureRecordId}`}
        title="Send the screenshot as a secure link via a Pancake Private Reply to the exact resolved Live comment (within 7 days). If the comment can't be safely resolved it becomes Needs Review — never a doomed photo send."
      >
        {sending ? 'Sending…' : '🔗 Send link'}
      </Button>
      {fbUrl ? (
        <a
          href={fbUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          data-testid={`incoming-openfb-${captureRecordId}`}
          title="Or open the chat and send it yourself (allowed up to 7 days)."
        >
          💬 Open FB Chat
        </a>
      ) : null}
    </span>
  );
}
