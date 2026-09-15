'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  approveCaptureReviewAction,
  rejectCaptureReviewAction,
} from '@/lib/capture/review-actions';
import type { CaptureReviewRow } from '@/lib/capture/review-types';
import { Money } from '@/components/shell/privacy';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Review Mode queue (live-readiness). While a live session runs in Review Mode,
 * captures wait here instead of auto-creating orders. A reviewer approves (which
 * creates the order via the same create_capture_order path — it lands in For Invoice)
 * or rejects (discards it). Rows arrive/leave live via the realtime → router.refresh
 * on capture_review_queue. Self-hides when the queue is empty.
 */
export function CaptureReviewPanel({ rows }: { rows: CaptureReviewRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reject DISCARDS the capture and sits next to Approve, so it asks first (system audit
  // 2026-09-16). The optional reason lands in the audit trail.
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  if (rows.length === 0) return null;

  // The dialog only ever points at a capture that is STILL in the queue: if another reviewer
  // (or realtime) removed it, the dialog closes instead of rejecting a vanished row.
  const target = rejecting ? (rows.find((r) => r.id === rejecting) ?? null) : null;

  const openReject = (id: string) => {
    setError(null);
    setRejectReason('');
    setRejecting(id);
  };
  const closeReject = () => {
    setRejecting(null);
    setRejectReason('');
    setError(null);
  };

  const act = async (id: string, kind: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(id);
    setError(null);
    const res =
      kind === 'approve'
        ? await approveCaptureReviewAction(id)
        : await rejectCaptureReviewAction(id, rejectReason.trim() || null);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    closeReject();
    router.refresh();
  };

  return (
    <section
      className="rounded-xl border border-gold/40 bg-gold/5 p-4"
      data-testid="capture-review-panel"
      aria-labelledby="capture-review-h"
    >
      <h2 id="capture-review-h" className="text-sm font-semibold text-gold-strong">
        Captures awaiting review ({rows.length})
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        Review Mode is on — captures wait here until approved. Approve to create the order
        (it lands in For Invoice), or reject to discard.
      </p>
      {error && !target ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">
                {r.customerName}
                {r.isTest ? (
                  <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                    Test
                  </span>
                ) : null}
              </p>
              <p className="break-words text-xs text-muted-foreground">
                {r.itemCode ?? r.itemName ?? 'Item'}
                {r.grams ? ` · ${r.grams}g` : ''} · <Money amount={r.price} />
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void act(r.id, 'approve')}
                disabled={busy === r.id}
                data-testid={`capture-review-approve-${r.id}`}
              >
                {busy === r.id ? 'Working…' : 'Approve'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openReject(r.id)}
                disabled={busy === r.id}
                data-testid={`capture-review-reject-${r.id}`}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={target !== null}
        onClose={closeReject}
        critical
        size="sm"
        title="Reject this capture?"
        description="The capture is discarded and no order is created. This cannot be undone."
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeReject}>
              Back
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => target && void act(target.id, 'reject')}
              disabled={busy !== null}
              data-testid="capture-review-reject-confirm"
            >
              {busy ? 'Working…' : 'Reject Capture'}
            </Button>
          </>
        }
      >
        {target ? (
          <p className="mb-3 text-sm" data-testid="capture-review-reject-target">
            <span className="font-medium">{target.customerName}</span> ·{' '}
            {target.itemCode ?? target.itemName ?? 'Item'}
          </p>
        ) : null}
        {error && target ? (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Reason (optional)</span>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3"
            maxLength={200}
          />
        </label>
      </Modal>
    </section>
  );
}
