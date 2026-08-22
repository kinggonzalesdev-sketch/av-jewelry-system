'use client';

import { Button } from '@/components/ui/button';

/**
 * The per-row ACTION control in Incoming Captures (Owner 2026-08-22). The layout stays consistent:
 * Print | Send | Use | Dismiss — Send is ALWAYS visible; only its ENABLED state changes. Send NEVER
 * disappears just because AUTO TEXT / AUTO SS succeeded or the customer is Photo-waiting.
 *
 * Send ALWAYS means: send the ACTUAL screenshot PHOTO (never a Private Reply TEXT / secure link /
 * Save / retry). It is ENABLED only when a valid screenshot exists AND the customer is Photo-ready
 * AND the photo has not already been sent; otherwise it is VISIBLE-BUT-DISABLED:
 *   • Photo ready + photo unsent + screenshot → ENABLED.
 *   • Photo waiting / AUTO TEXT sent + waiting → disabled (auto-enables when eligibility flips).
 *   • AUTO SS / photo already sent          → disabled (one photo per capture — the DB is authoritative).
 *   • Screenshot missing / Test capture     → disabled.
 *
 * The AUTO TEXT/SS delivery STATUS lives in its dedicated area under Grams/Price — never here. 💾 Save
 * appears ONLY when there are unsaved edits and never sends anything.
 */
export function CaptureSendControl({
  captureRecordId,
  photoEligible,
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
  photoEligible: boolean;
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
  // The ACTUAL photo can be sent only when eligible, unsent, with a screenshot, and not a test.
  const canSend = !isTest && hasScreenshot && photoEligible && !photoSent;

  const title = isTest
    ? 'A test capture never messages a real customer.'
    : !hasScreenshot
      ? 'No screenshot on this capture — nothing to send.'
      : photoSent
        ? 'The actual screenshot photo was already sent (AUTO SS) — one photo per capture.'
        : !photoEligible
          ? 'Photo waiting — the customer has no open Inbox window yet, so a photo can’t be sent (a secure-link TEXT is sent automatically).'
          : 'Send the ACTUAL screenshot photo now.';

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
