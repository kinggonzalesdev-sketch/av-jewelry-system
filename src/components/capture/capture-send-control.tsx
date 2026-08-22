'use client';

import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The per-row action control in Incoming Captures (Owner 2026-08-22 — messaging is AUTOMATIC +
 * server-side; the row shows the CURRENT actionable state, never stale internal router states).
 *
 * Precedence — the row reflects ONE authoritative messaging state, highest first:
 *   1. Test capture        → 📨 Send disabled (a test never messages a real customer).
 *   2. Photo already sent  → "AUTO SS Sent to Messenger ✓" (message_status 'sent'; no duplicate Send).
 *   3. Photo READY         → 📨 Send (the ACTUAL screenshot photo). This SUPERSEDES any stale/pending
 *                            Route-B state (awaiting / failed / "pending") — current eligibility is
 *                            authoritative; the customer is reachable now, so send the real photo.
 *   4. TEXT already sent    → "AUTO TEXT Sent to Messenger ✓" (message_status 'link_sent', still
 *                            Photo-waiting) — the secure-link Private Reply audit.
 *   5. Photo waiting        → the panel shows "Photo waiting"; here only 💬 Open FB Chat (human
 *                            fallback). Route B runs in the background.
 *
 * NEVER shown in the normal row: internal router terminology (pending / awaiting comment context /
 * sending / backoff / route_reason). Those live in diagnostics/audit only.
 *
 * 💾 Save is NOT a permanent action — it appears ONLY when the operator has unsaved edits (`dirty`,
 * e.g. a changed grams / Fixed Price value). It persists edits and NEVER sends any Messenger message;
 * after a successful Save the row returns to the correct state above.
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

  const status = messageStatus ?? '';
  const photoSent = status === 'sent';
  const linkSent = status === 'link_sent';

  // Save ONLY when there are unsaved edits — never a permanent primary action, never sends anything.
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

  // The SINGLE current messaging element, in authoritative precedence.
  let messaging: React.ReactNode;
  if (photoSent) {
    messaging = (
      <span
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700"
        data-testid={`incoming-status-${captureRecordId}`}
      >
        AUTO SS Sent to Messenger ✓
      </span>
    );
  } else if (photoEligible) {
    // Photo READY supersedes any stale Route-B awaiting/failed/pending state → send the real photo.
    messaging = (
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
  } else if (linkSent) {
    messaging = (
      <span
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700"
        data-testid={`incoming-status-${captureRecordId}`}
      >
        AUTO TEXT Sent to Messenger ✓
      </span>
    );
  } else {
    // Photo waiting — the panel already shows "Photo waiting"; Route B is automatic + server-side.
    // Offer only the human fallback (never internal pending/awaiting text).
    messaging = fbUrl ? (
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
    ) : null;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {messaging}
      {saveButton}
    </span>
  );
}
