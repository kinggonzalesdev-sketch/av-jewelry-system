'use client';

import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The per-row ACTION control in Incoming Captures (Owner 2026-08-22).
 *
 * This is the right-side action area only: `Print | Send | Use | Dismiss`. It renders NO delivery
 * status — the "AUTO TEXT Sent to Messenger ✓" / "AUTO SS Sent to Messenger ✓" statuses live in a
 * DEDICATED area UNDER the Grams/Price (see incoming-captures-strip), and a status must NEVER occupy
 * or replace the Send button.
 *
 *   📨 Send — shown ONLY when the customer is genuinely Photo-ready (media-eligible) AND the actual
 *             PHOTO has not been sent. Send ALWAYS means the actual screenshot PHOTO (never a secure
 *             link / Private Reply TEXT). A doomed photo send is never offered.
 *   💬 Open FB Chat — the human fallback while Photo-waiting (Route B TEXT runs automatically in the
 *             background; the operator never clicks to send it).
 *   💾 Save — appears ONLY when the operator has unsaved grams / Fixed-Price edits (`dirty`); it
 *             persists edits and NEVER sends anything.
 *   (photo already sent) — no Send (prevents a duplicate/misleading send); the AUTO SS status shows
 *             under Grams/Price.
 *   Test capture — a disabled Send marker (a test never messages a real customer).
 */
export function CaptureSendControl({
  captureRecordId,
  photoEligible,
  fbUrl,
  isTest,
  sending,
  saving,
  messageStatus,
  dirty,
  onSend,
  onSave,
}: {
  captureRecordId: string;
  photoEligible: boolean;
  fbUrl: string | null;
  isTest: boolean;
  sending: boolean;
  saving: boolean;
  /** Router state: 'sent' (photo) | 'link_sent' (TEXT) | 'failed' | 'awaiting_inbox' | 'pending' | … */
  messageStatus: string | null;
  /** True only when the operator has unsaved row edits (changed grams / Fixed Price value). */
  dirty: boolean;
  onSend: () => void;
  onSave: () => void;
}) {
  // Test capture: a disabled Send marker; nothing else (a test never messages, never needs Save).
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

  const photoSent = (messageStatus ?? '') === 'sent';

  // Save ONLY when there are unsaved edits — never a permanent action, never sends anything.
  const saveButton = dirty ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={saving}
      onClick={onSave}
      data-testid={`incoming-save-${captureRecordId}`}
      title="Save your edits (grams / Fixed Price). Messaging is automatic — this never sends anything."
    >
      {saving ? 'Saving…' : '💾 Save'}
    </Button>
  ) : null;

  // The single ACTION element (never a status): Send when Photo-ready-and-unsent; the human fallback
  // while Photo-waiting; nothing once the photo is sent (its AUTO SS status sits under Grams/Price).
  let action: React.ReactNode = null;
  if (photoEligible && !photoSent) {
    action = (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={sending}
        onClick={onSend}
        data-testid={`incoming-send-${captureRecordId}`}
        title="Send the ACTUAL screenshot photo now (the server also auto-sends it to eligible customers)."
      >
        {sending ? 'Sending…' : '📨 Send'}
      </Button>
    );
  } else if (!photoSent && !photoEligible && fbUrl) {
    action = (
      <a
        href={fbUrl}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        data-testid={`incoming-openfb-${captureRecordId}`}
        title="Human fallback: open the chat and send it yourself (allowed up to 7 days)."
      >
        💬 Open FB Chat
      </a>
    );
  }

  if (!action && !saveButton) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {action}
      {saveButton}
    </span>
  );
}
