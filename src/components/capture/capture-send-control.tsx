'use client';

import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The per-row action control in Incoming Captures (Owner 2026-08-22 — messaging is now fully
 * AUTOMATIC + SERVER-SIDE via the durable cron router, so the operator NEVER clicks to send).
 *
 * What the operator sees here:
 *   • 💾 Save — persists their row edits (corrected grams + note) ONLY. It NEVER sends a Messenger
 *     message. This replaces the old "🔗 Auto-sending secure link…" button the Owner asked to remove.
 *   • 📨 Send Photo — shown ONLY when the customer is genuinely Photo-ready (media-eligible) and the
 *     screenshot hasn't been sent yet: a MANUAL backup that delivers the ACTUAL screenshot PHOTO
 *     (never a secure link). The server auto-sends this too; this is just the manual retry.
 *   • A finite STATUS chip (not a button) once the server router finishes:
 *        message_status 'sent'      → "AUTO SS Sent to Messenger ✓"   (actual photo delivered)
 *        message_status 'link_sent' → "AUTO TEXT Sent to Messenger ✓" (secure-link Private Reply)
 *        message_status 'failed'    → the router's finite reason (route_reason), e.g. "AUTO TEXT
 *                                     Failed · awaiting comment context"
 *   • 💬 Open FB Chat — the human fallback, shown when a send failed or is still waiting.
 *
 * There is NO indefinite "sending…" spinner: the router persists a finite state, which this only
 * DISPLAYS. A Test capture never messages a real customer (Send stays disabled).
 */
export function CaptureSendControl({
  captureRecordId,
  photoEligible,
  fbUrl,
  isTest,
  sending,
  saving,
  messageStatus,
  routeReason,
  onSend,
  onSave,
}: {
  captureRecordId: string;
  photoEligible: boolean;
  fbUrl: string | null;
  isTest: boolean;
  sending: boolean;
  saving: boolean;
  /** The durable router's message_status: 'sent' | 'link_sent' | 'failed' | 'awaiting_inbox' | … */
  messageStatus: string | null;
  /** The router's last human-safe finite reason (shown when failed). */
  routeReason: string | null;
  onSend: () => void;
  onSave: () => void;
}) {
  // A Test capture never messages a real customer — keep a disabled Send as the visible marker.
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
  const sent = status === 'sent';
  const linkSent = status === 'link_sent';
  const failed = status === 'failed';

  const saveButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={saving}
      onClick={onSave}
      data-testid={`incoming-save-${captureRecordId}`}
      title="Save your edits (corrected grams / note). Messaging is automatic — this never sends anything."
    >
      {saving ? 'Saving…' : '💾 Save'}
    </Button>
  );

  const openFbChat = fbUrl ? (
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

  // TERMINAL success → a finite green status chip (not a button) + Save (edits still allowed).
  if (sent || linkSent) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700"
          data-testid={`incoming-status-${captureRecordId}`}
        >
          {sent ? 'AUTO SS Sent to Messenger ✓' : 'AUTO TEXT Sent to Messenger ✓'}
        </span>
        {saveButton}
      </span>
    );
  }

  // TERMINAL failure → a finite reason chip + Save + the human fallback (never a spinner).
  if (failed) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-800"
          data-testid={`incoming-status-${captureRecordId}`}
        >
          {routeReason?.trim() || 'AUTO Failed · needs attention'}
        </span>
        {saveButton}
        {openFbChat}
      </span>
    );
  }

  // NOT yet sent. Photo-ready → a MANUAL actual-photo backup (the server also auto-sends). Photo
  // waiting → just Save + the fallback; the secure-link TEXT is sent automatically by the server.
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {photoEligible ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={sending}
          onClick={onSend}
          data-testid={`incoming-send-${captureRecordId}`}
          title="Send the ACTUAL screenshot photo now (manual backup — the server also auto-sends it)."
        >
          {sending ? 'Sending…' : '📨 Send Photo'}
        </Button>
      ) : null}
      {saveButton}
      {!photoEligible ? openFbChat : null}
    </span>
  );
}
