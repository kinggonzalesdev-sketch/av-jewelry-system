'use client';

import { useActionState, useId, useState } from 'react';

import { captureClaimAction, setCurrentFlexItemAction } from '@/lib/live/actions';
import type { ActionState } from '@/lib/live/action-state';
import { EMPTY_ACTION_STATE } from '@/lib/live/action-state';
import type { LiveBatchItemRow } from '@/lib/live/batches';
import { PhotoCapture } from '@/components/attachments/photo-capture';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Live capture (Bible §12, §13) — Current Flex Item control and claim capture.
 *
 * CAPTURE CREATES A PENDING CLAIM AND NOTHING ELSE. No reservation, no
 * confirmation, no label, no invoice, no Official Order, and no auto-match
 * (§12.3, §13.2). Stock does not move here; the reservation point is Confirm.
 *
 * Switching the Current Flex Item affects FUTURE capture only — claims already
 * captured are untouched, because they recorded what was flexed at the time.
 *
 * The idempotency key is generated per form instance, so the classic flaky-signal
 * double tap during a Live reuses it and returns the SAME claim rather than
 * creating a second one.
 */
export function LiveCapturePanel({
  liveBatchId,
  batchStatus,
  items,
  customers,
  canControlFlex,
  canCapture,
}: {
  liveBatchId: string;
  batchStatus: string;
  items: LiveBatchItemRow[];
  customers: Array<{ id: string; displayName: string }>;
  canControlFlex: boolean;
  canCapture: boolean;
}) {
  const [flexState, setFlex, settingFlex] = useActionState<ActionState, FormData>(
    setCurrentFlexItemAction,
    EMPTY_ACTION_STATE,
  );
  const [captureState, capture, capturing] = useActionState<ActionState, FormData>(
    captureClaimAction,
    EMPTY_ACTION_STATE,
  );

  const currentFlex = items.find((i) => i.isCurrentFlexItem) ?? null;

  // The idempotency key must be STABLE for a given rendered form and CHANGE once
  // a capture has been submitted. That is exactly what makes the flaky-signal
  // double tap safe: both taps carry the same key, so the second returns the
  // first claim instead of creating a second one.
  //
  // Built from useId() + a submit counter rather than Date.now(): a clock read is
  // impure during render, and a key that changes on every re-render would defeat
  // the deduplication this exists to provide.
  const reactId = useId();
  const [captureNonce, setCaptureNonce] = useState(0);
  const idempotencyKey = `capture-${liveBatchId}-${reactId}-${captureNonce}`;

  const isOpen = batchStatus === 'open';

  return (
    <div className="space-y-3">
      {/* --- Current Flex Item ------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Flex Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm" data-testid="current-flex">
            {currentFlex ? (
              <>
                <span className="font-medium">{currentFlex.itemCode}</span>
                {currentFlex.itemName ? ` — ${currentFlex.itemName}` : ''}
              </>
            ) : (
              <span className="text-muted-foreground">
                No Current Flex Item set for this batch.
              </span>
            )}
          </p>

          {canControlFlex && items.length > 0 && (
            <form action={setFlex} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="liveBatchId" value={liveBatchId} />
              <div className="space-y-1">
                <Label htmlFor={`flex-${liveBatchId}`} className="text-xs">
                  Set Current Flex Item
                </Label>
                <select
                  id={`flex-${liveBatchId}`}
                  name="liveBatchItemId"
                  className="flex h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {items.map((i) => (
                    <option key={i.liveBatchItemId} value={i.liveBatchItemId}>
                      {i.itemCode}
                      {i.itemName ? ` — ${i.itemName}` : ''}
                      {i.availableQuantity !== null
                        ? ` (${i.availableQuantity} available)`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={settingFlex}>
                Set
              </Button>
            </form>
          )}

          <p className="text-xs text-muted-foreground">
            Switching the flex item affects <strong>future capture only</strong>. Claims
            already captured keep the item they were captured against.
          </p>

          {flexState.error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {flexState.error}
            </p>
          )}
          {flexState.success && (
            <p role="status" className="text-xs font-medium">
              {flexState.success}
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- Capture ------------------------------------------------------ */}
      {canCapture && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capture claim</CardTitle>
          </CardHeader>
          <CardContent>
            {!isOpen ? (
              <p className="text-sm text-muted-foreground">
                This batch is {batchStatus}. Capture is available while a batch is open.
              </p>
            ) : !currentFlex ? (
              <p className="text-sm text-muted-foreground">
                Set a Current Flex Item before capturing — a claim records what was
                flexed.
              </p>
            ) : (
              <div className="space-y-3">
                {/* Photograph the flexed item with the rear camera (or upload a
                    file on desktop). The photo attaches to the ITEM record, so it
                    is captured even before the claim exists — exactly what "take a
                    photo of the item the client claimed" needs. */}
                <PhotoCapture
                  key={currentFlex.inventoryItemId}
                  relatedEntityType="inventory_item"
                  relatedEntityId={currentFlex.inventoryItemId}
                  purpose="photo"
                  label={`Photo of ${currentFlex.itemCode}${currentFlex.itemName ? ` — ${currentFlex.itemName}` : ''}`}
                />

                <form
                  action={capture}
                  className="space-y-3"
                  onSubmit={() => setCaptureNonce((n) => n + 1)}
                >
                  <input type="hidden" name="liveBatchId" value={liveBatchId} />
                  <input
                    type="hidden"
                    name="liveBatchItemId"
                    value={currentFlex.liveBatchItemId}
                  />
                  <input
                    type="hidden"
                    name="inventoryItemId"
                    value={currentFlex.inventoryItemId}
                  />
                  <input type="hidden" name="captureMethod" value="manual_live_entry" />
                  <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`customer-${liveBatchId}`}>Customer</Label>
                      <select
                        id={`customer-${liveBatchId}`}
                        name="customerId"
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select a customer…</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.displayName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`qty-${liveBatchId}`}>Quantity</Label>
                      <Input
                        id={`qty-${liveBatchId}`}
                        name="quantity"
                        type="number"
                        min={1}
                        defaultValue={1}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`note-${liveBatchId}`}>Note (optional)</Label>
                    <Input id={`note-${liveBatchId}`} name="note" />
                  </div>

                  <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                    Capture creates a <strong>Pending Claim only</strong>. No stock is
                    reserved, nothing is confirmed, no label is queued and no order is
                    created. Confirm Claim &amp; Print Label is where stock moves.
                  </p>

                  <Button type="submit" disabled={capturing}>
                    {capturing ? 'Capturing…' : 'Capture Pending Claim'}
                  </Button>

                  {captureState.error && (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {captureState.error}
                    </p>
                  )}
                  {captureState.success && (
                    <p role="status" className="text-sm font-medium">
                      {captureState.success}
                    </p>
                  )}
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
