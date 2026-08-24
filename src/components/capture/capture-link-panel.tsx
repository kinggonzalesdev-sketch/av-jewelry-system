'use client';

import { useState } from 'react';

import {
  clearCaptureLinkAction,
  listCaptureCandidatesAction,
  setCaptureCustomerAction,
} from '@/lib/capture/pending-actions';
import type {
  CaptureCandidateOption,
  CaptureLinkResult,
  CaptureLinkStatus,
} from '@/lib/capture/pending-types';

/**
 * "Linked Facebook Customer" panel for one pending capture (Capture-time linking,
 * 2026-08-09). Shows who the capture resolved to and lets the operator confirm /
 * change / remove the link — the wrong-customer safety valve. When 2+ people share
 * the name, it shows a picker instead of guessing. Purely presentational + a few
 * server-action calls; the parent owns the resolve-once-per-capture trigger.
 */
export type EffectiveCaptureLink = {
  linkStatus: CaptureLinkStatus;
  linkedCustomerName: string | null;
  conversationAvailable: boolean;
  /** True only when a normal Inbox PHOTO can actually be delivered now (a genuine customer Inbox
   *  DM inside the media window). A `linked` comment-only customer is false — "Photo waiting". */
  photoEligible: boolean;
  fbUrl: string | null;
  matchCount: number;
};

const DOT: Record<string, string> = {
  linked: 'bg-emerald-500',
  customer_no_chat: 'bg-amber-500',
  needs_confirmation: 'bg-amber-500',
  no_match: 'bg-muted-foreground',
};

export function CaptureLinkPanel({
  captureRecordId,
  link,
  onChanged,
  onRecheck,
  messageStatus = null,
}: {
  captureRecordId: string;
  link: EffectiveCaptureLink;
  onChanged: (result: CaptureLinkResult) => void;
  /** Re-run the full resolver for this capture (pulls the live post's comments from
   *  Pancake and retries the match) — the fix for a commenter the realtime webhook was
   *  slow to deliver. Returns the fresh link. When omitted, no Re-check button shows. */
  onRecheck?: (captureRecordId: string) => Promise<CaptureLinkResult>;
  /** The capture's durable routing state (Owner 2026-08-24) — drives the bottom wording so
   *  "Photo waiting" is never a dead-end: 'sent' → Photo sent ✓, 'link_sent' → Waiting for reply
   *  to send screenshot, 'failed' → AUTO TEXT not sent, else → Preparing AUTO TEXT. */
  messageStatus?: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<CaptureCandidateOption[] | null>(null);
  const [busy, setBusy] = useState(false);

  const status = link.linkStatus;
  const resolving = status === null;

  const openPicker = async () => {
    setPicking(true);
    if (candidates === null) {
      const list = await listCaptureCandidatesAction(captureRecordId);
      setCandidates(list);
    }
  };

  const choose = async (customerId: string) => {
    if (busy) return;
    setBusy(true);
    const res = await setCaptureCustomerAction(captureRecordId, customerId);
    setBusy(false);
    if (res.ok) {
      onChanged(res);
      setPicking(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const res = await clearCaptureLinkAction(captureRecordId);
    setBusy(false);
    if (res.ok) {
      onChanged(res);
      setPicking(false);
    }
  };

  const recheck = async () => {
    if (busy || !onRecheck) return;
    setBusy(true);
    const res = await onRecheck(captureRecordId);
    setBusy(false);
    if (res.ok) onChanged(res);
  };

  const dot = DOT[status ?? ''] ?? 'bg-muted-foreground';

  const label = resolving ? (
    <span className="text-muted-foreground">Resolving Facebook customer…</span>
  ) : status === 'linked' ? (
    <span>
      <span className="font-medium text-foreground">
        {link.linkedCustomerName ?? 'Facebook customer'}
      </span>{' '}
      {/* "Chat linked" (a real customer/conversation is resolved) is NOT the same as photo-send
          eligibility. A comment-only customer is linked but the normal Inbox PHOTO route will be
          rejected by Facebook until they send a genuine Inbox DM — so show the photo state too. */}
      <span className="text-emerald-600">· Chat linked</span>{' '}
      {/* The bottom wording is state-accurate, never a dead-end "Photo waiting" (Owner 2026-08-24):
          photo already sent → done; photo-eligible now → Photo ready; AUTO TEXT delivered → waiting
          for the reply that opens the photo window; finite failure → AUTO TEXT not sent; otherwise
          the server router is still working → Preparing AUTO TEXT. "Waiting for reply to send
          screenshot" appears ONLY after a confirmed AUTO TEXT success. */}
      {messageStatus === 'sent' ? (
        <span
          className="text-emerald-600"
          title="The actual screenshot photo was sent to the customer."
        >
          · Photo sent ✓
        </span>
      ) : link.photoEligible ? (
        <span
          className="text-emerald-600"
          title="The customer has a recent Inbox message — a photo can be sent now."
        >
          · Photo ready
        </span>
      ) : messageStatus === 'link_sent' ? (
        <span
          className="text-sky-600"
          title="The AUTO TEXT reached the customer via a Pancake Private Reply. When they reply, the Inbox window opens and the actual screenshot can be sent."
        >
          · Waiting for reply to send screenshot
        </span>
      ) : messageStatus === 'failed' ? (
        <span
          className="text-amber-700"
          title="The AUTO TEXT could not be sent automatically (no privately-replyable comment / outside the window). Use Open chat to message the customer."
        >
          · AUTO TEXT not sent
        </span>
      ) : (
        <span
          className="text-sky-600"
          title="Sending the AUTO TEXT to the customer automatically…"
        >
          · Preparing AUTO TEXT
        </span>
      )}
    </span>
  ) : status === 'customer_no_chat' ? (
    <span>
      <span className="font-medium text-foreground">
        {link.linkedCustomerName ?? 'Customer'}
      </span>{' '}
      <span className="text-amber-700">· no chat linked yet</span>
    </span>
  ) : status === 'needs_confirmation' ? (
    <span className="text-amber-800">
      {link.matchCount > 1
        ? `${link.matchCount} people share this name`
        : 'Same name shared'}{' '}
      — pick the right one
    </span>
  ) : (
    <span className="text-muted-foreground">No Facebook match</span>
  );

  return (
    <div
      className="mt-1 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px]"
      data-testid={`capture-link-${captureRecordId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 break-words">{label}</span>
        {!resolving ? (
          <div className="flex items-center gap-1.5">
            {status === 'linked' && link.fbUrl ? (
              <a
                href={link.fbUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
              >
                Open chat
              </a>
            ) : null}
            {onRecheck && (status === 'no_match' || status === 'customer_no_chat') ? (
              <button
                type="button"
                onClick={() => void recheck()}
                disabled={busy}
                data-testid={`capture-link-recheck-${captureRecordId}`}
                className="rounded border border-border px-1.5 py-0.5 font-medium hover:bg-accent"
                title="Pull the live's comments from Pancake and try to match again"
              >
                {busy ? 'Checking…' : '🔄 Re-check FB'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void openPicker()}
              disabled={busy}
              data-testid={`capture-link-change-${captureRecordId}`}
              className="rounded border border-border px-1.5 py-0.5 font-medium hover:bg-accent"
            >
              {status === 'needs_confirmation' || status === 'no_match'
                ? 'Pick customer'
                : 'Change'}
            </button>
            {status === 'linked' || status === 'customer_no_chat' ? (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {picking ? (
        <div className="mt-1.5 space-y-1 border-t border-border pt-1.5">
          {candidates === null ? (
            <p className="text-muted-foreground">Loading customers…</p>
          ) : candidates.length === 0 ? (
            <p className="text-muted-foreground">No same-name customers found.</p>
          ) : (
            <ul className="space-y-0.5">
              {candidates.map((c) => (
                <li key={c.customerId}>
                  <button
                    type="button"
                    onClick={() => void choose(c.customerId)}
                    disabled={busy}
                    data-testid={`capture-link-pick-${captureRecordId}-${c.customerId}`}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent"
                  >
                    {c.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatarUrl}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground">
                        ?
                      </span>
                    )}
                    <span className="font-medium">{c.displayName}</span>
                    {c.contactNumber ? (
                      <span className="text-muted-foreground">· {c.contactNumber}</span>
                    ) : null}
                    {c.hasConversation ? (
                      <span className="text-emerald-600">· chat</span>
                    ) : (
                      <span className="text-muted-foreground">· no chat</span>
                    )}
                    <span className="ml-auto font-semibold text-gold">Use →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
