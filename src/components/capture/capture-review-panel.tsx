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

  if (rows.length === 0) return null;

  const act = async (id: string, kind: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(id);
    setError(null);
    const res =
      kind === 'approve'
        ? await approveCaptureReviewAction(id)
        : await rejectCaptureReviewAction(id, null);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
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
      {error ? (
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
                onClick={() => void act(r.id, 'reject')}
                disabled={busy === r.id}
                data-testid={`capture-review-reject-${r.id}`}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
