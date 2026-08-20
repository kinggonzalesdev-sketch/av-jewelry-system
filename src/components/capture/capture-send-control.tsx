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
 *   Photo ready               → 📨 Send        (the manual backup/retry; eligible normally auto-sends)
 *   Photo waiting + FB chat    → 💬 Open FB Chat (the human fallback, allowed up to 7 days)
 *   Photo waiting + no chat     → Photo waiting  (neutral, disabled)
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
}: {
  captureRecordId: string;
  photoEligible: boolean;
  fbUrl: string | null;
  isTest: boolean;
  sending: boolean;
  onSend: () => void;
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

  // Photo waiting — no supported auto/normal PHOTO route. Offer the human fallback (Open FB Chat)
  // when we have a usable Messenger URL; never attempt the doomed reply_inbox PHOTO.
  if (fbUrl) {
    return (
      <a
        href={fbUrl}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        data-testid={`incoming-openfb-${captureRecordId}`}
        title="No auto-photo route yet (the customer hasn't sent an Inbox message) — open the chat and send it yourself (allowed up to 7 days)."
      >
        💬 Open FB Chat
      </a>
    );
  }

  // Photo waiting with no usable FB chat URL — a neutral, disabled waiting state (no route at all).
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled
      data-testid={`incoming-waiting-${captureRecordId}`}
      title="Waiting for the customer to send an Inbox message — a photo can't be sent yet."
    >
      Photo waiting
    </Button>
  );
}
