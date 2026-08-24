'use client';

import { Button } from '@/components/ui/button';

/**
 * The per-row ACTION control in Incoming Captures. The layout stays consistent: Print | Send | Use |
 * Dismiss — Send is ALWAYS visible; only its ENABLED state changes.
 *
 * MANUAL SEND vs AUTO SCREENSHOT are INDEPENDENT (Owner 2026-08-24, Issue 3). Send is ENABLED whenever
 * the capture is LINKED to a valid conversation, has a screenshot, and the photo has not already been
 * sent — it does NOT wait for a customer reply. The auto-screenshot "waiting for reply" display state
 * never disables Send. The server still validates messaging at send time (a photo only goes when the
 * Inbox window is open; otherwise the operator gets an honest note), so enabling the button is safe.
 *   • Linked + photo unsent + screenshot → ENABLED (send now; photo if the window is open).
 *   • Photo already sent                 → disabled (one photo per capture — the DB is authoritative).
 *   • Not linked / no screenshot / Test  → disabled.
 *
 * The AUTO TEXT/SS delivery STATUS lives in its dedicated area under Grams/Price — never here. 💾 Save
 * appears ONLY when there are unsaved edits and never sends anything.
 */
export function CaptureSendControl({
  captureRecordId,
  photoEligible,
  chatLinked,
  hasScreenshot,
  isTest,
  sending,
  saving,
  messageStatus,
  dirty,
  onSend,
  onSave,
}: {
  captureRecordId: string;
  /** The customer has an open Inbox window right now — a PHOTO can actually be delivered. Drives the
   *  tooltip only; it no longer gates the button (manual Send is independent of the reply wait). */
  photoEligible: boolean;
  /** The capture is linked to a valid, messageable conversation on the active page (a recipient
   *  exists). This — not photoEligible — is what enables the manual Send button. */
  chatLinked: boolean;
  /** A valid screenshot exists for this capture (a photo can physically be sent). */
  hasScreenshot: boolean;
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
  const photoSent = (messageStatus ?? '') === 'sent';
  // Manual Send is ENABLED when the chat is linked (a recipient exists), a screenshot exists, the
  // photo hasn't already gone out, and it isn't a test — INDEPENDENT of the reply-wait. The send
  // action validates the messaging window server-side.
  const canSend = !isTest && hasScreenshot && chatLinked && !photoSent;

  const title = isTest
    ? 'A test capture never messages a real customer.'
    : !hasScreenshot
      ? 'No screenshot on this capture — nothing to send.'
      : photoSent
        ? 'The actual screenshot photo was already sent (AUTO SS) — one photo per capture.'
        : !chatLinked
          ? 'Link the customer’s Messenger chat first (Change / Pick customer), then Send.'
          : photoEligible
            ? 'Send the screenshot photo now.'
            : 'Send now. The customer has no open Inbox window yet, so the photo auto-sends once they reply; use Open FB Chat if you need to reach them now.';

  const saveButton = dirty && !isTest ? (
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

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canSend || sending}
        onClick={onSend}
        data-testid={`incoming-send-${captureRecordId}`}
        title={title}
      >
        {sending ? 'Sending…' : '📨 Send'}
      </Button>
      {saveButton}
    </span>
  );
}
