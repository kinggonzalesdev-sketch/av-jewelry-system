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
 *   Link sent (Route B)        → ✓ Link sent   (a secure-link Private Reply went out; waiting for reply — NEVER resend)
 *   Photo ready               → 📨 Send        (the manual backup/retry; eligible normally auto-sends the PHOTO)
 *   Photo waiting             → 🔗 Auto-sending secure link…  (Route B now fires AND retries automatically,
 *                                               NO operator click — Owner 2026-08-22; the manual "Send link"
 *                                               button is retired) + 💬 Open FB Chat as the human fallback
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
        title="A secure screenshot link was sent to the customer via a Pancake Private Reply — waiting for their reply. Not resent."
      >
        ✓ Link sent
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

  // Photo waiting — no NORMAL Inbox PHOTO route. Route B (secure-link Private Reply to the exact Live
  // comment) now fires AND retries AUTOMATICALLY with NO operator click (Owner 2026-08-22), so the
  // manual "Send link" button is retired: show a passive auto-status. Open FB Chat stays as the human
  // fallback (allowed up to 7 days) for when the Private Reply link genuinely can't be sent. The
  // `sending`/`onSend` props remain for the Photo-ready manual PHOTO retry above.
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-amber-700"
        data-testid={`incoming-waiting-${captureRecordId}`}
        title="A secure screenshot link is being sent automatically to the customer's exact Live comment via a Pancake Private Reply — no action needed. If it can't be sent, use Open FB Chat."
      >
        🔗 Auto-sending secure link…
      </span>
      {fbUrl ? (
        <a
          href={fbUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          data-testid={`incoming-openfb-${captureRecordId}`}
          title="Fallback: open the chat and send it yourself (allowed up to 7 days)."
        >
          💬 Open FB Chat
        </a>
      ) : null}
    </span>
  );
}
