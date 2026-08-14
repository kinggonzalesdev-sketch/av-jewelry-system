'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFormGrid } from '@/components/ui/modal';
import {
  recordCollectionAction,
  recordRemittanceAction,
  setCollectionChannelAction,
} from '@/lib/fulfillment/actions';
import {
  EMPTY_FULFILLMENT_STATE,
  type FulfillmentActionState,
} from '@/lib/fulfillment/action-state';
import { channelLabel } from '@/lib/fulfillment/format';
import type { FulfillmentRow } from '@/lib/fulfillment/service';
import { usePrivacyMoney } from '@/components/shell/privacy';

/**
 * COD collection & remittance controls + the Waybill link (#3 deeper).
 *
 * Every write here is permission-gated server-side (fulfillment_release) and the
 * database enforces the rules — collection only on COD, remittance only after
 * collection. The buttons only offer the step the record is actually ready for.
 */
export function CollectionRemittanceControls({
  row,
  canRelease,
}: {
  row: FulfillmentRow;
  canRelease: boolean;
}) {
  const money = usePrivacyMoney();
  const [chState, setChannel, settingChannel] = useActionState<
    FulfillmentActionState,
    FormData
  >(setCollectionChannelAction, EMPTY_FULFILLMENT_STATE);
  const [colState, collect, collecting] = useActionState<
    FulfillmentActionState,
    FormData
  >(recordCollectionAction, EMPTY_FULFILLMENT_STATE);
  const [remState, remit, remitting] = useActionState<FulfillmentActionState, FormData>(
    recordRemittanceAction,
    EMPTY_FULFILLMENT_STATE,
  );

  const notice =
    chState.error ??
    colState.error ??
    remState.error ??
    chState.success ??
    colState.success ??
    remState.success;
  const isError = Boolean(chState.error ?? colState.error ?? remState.error);

  const showCollect = canRelease && row.isCod && row.dispatched && !row.collected;
  const showRemit = canRelease && row.isCod && row.collected && !row.remitted;

  // Record-collection opens in the standard modal; close once it succeeds.
  const [collectOpen, setCollectOpen] = useState(false);
  const lastCollect = useRef<string | null>(null);
  useEffect(() => {
    if (colState.success && colState.success !== lastCollect.current) {
      lastCollect.current = colState.success;
      setCollectOpen(false);
    }
  }, [colState.success]);

  const collectFormId = `collect-${row.officialOrderId}`;

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/orders/fulfillment/${row.officialOrderId}/waybill`}
          className="text-xs text-gold-strong underline"
        >
          Waybill
        </Link>

        {/* Live COD status. */}
        {row.isCod ? (
          <span className="text-xs text-muted-foreground">
            {row.remitted
              ? `Collected ${row.collectedAmount ? money(row.collectedAmount) : ''} via ${channelLabel(row.collectionChannel)} · Remitted`
              : row.collected
                ? `Collected ${row.collectedAmount ? money(row.collectedAmount) : ''} via ${channelLabel(row.collectionChannel)} · awaiting remittance`
                : row.collectionChannel
                  ? `To collect via ${channelLabel(row.collectionChannel)}`
                  : 'COD — collection channel not set'}
          </span>
        ) : null}
      </div>

      {/* Set the collection channel before collection so Money-in-Transit can
          split rider vs LBC. Available once dispatched, before collecting. */}
      {canRelease && row.isCod && row.dispatched && !row.collected ? (
        <form action={setChannel} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="officialOrderId" value={row.officialOrderId} />
          <div>
            <Label
              htmlFor={`ch-${row.officialOrderId}`}
              className="text-[11px] text-muted-foreground"
            >
              Channel
            </Label>
            <select
              id={`ch-${row.officialOrderId}`}
              name="channel"
              defaultValue={row.collectionChannel ?? ''}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="rider">Own Rider</option>
              <option value="lbc">LBC</option>
            </select>
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={settingChannel}>
            Set channel
          </Button>
        </form>
      ) : null}

      {showCollect ? (
        <>
          <Button type="button" size="sm" onClick={() => setCollectOpen(true)}>
            Record collection
          </Button>

          <Modal
            open={collectOpen}
            onClose={() => setCollectOpen(false)}
            title="Record COD collection"
            description="Records the amount actually collected and the channel it came through."
            size="sm"
            footer={
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCollectOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" form={collectFormId} disabled={collecting}>
                  {collecting ? 'Recording…' : 'Record collection'}
                </Button>
              </>
            }
          >
            <form id={collectFormId} action={collect} className="space-y-3">
              <input type="hidden" name="officialOrderId" value={row.officialOrderId} />
              <ModalFormGrid>
                <div>
                  <Label htmlFor={`cch-${row.officialOrderId}`} className="text-xs">
                    Collected via
                  </Label>
                  <select
                    id={`cch-${row.officialOrderId}`}
                    name="channel"
                    defaultValue={row.collectionChannel ?? ''}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    <option value="rider">Own Rider</option>
                    <option value="lbc">LBC</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor={`amt-${row.officialOrderId}`} className="text-xs">
                    Amount collected
                  </Label>
                  <MoneyInput
                    id={`amt-${row.officialOrderId}`}
                    name="amount"
                    placeholder="0.00"
                    className="mt-1 h-9 text-right tabular-nums"
                  />
                </div>
              </ModalFormGrid>
              {colState.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {colState.error}
                </p>
              ) : null}
            </form>
          </Modal>
        </>
      ) : null}

      {showRemit ? (
        <form action={remit}>
          <input type="hidden" name="officialOrderId" value={row.officialOrderId} />
          <Button type="submit" size="sm" variant="outline" disabled={remitting}>
            {remitting ? 'Recording…' : 'Record remittance'}
          </Button>
        </form>
      ) : null}

      {notice ? (
        <p
          role="status"
          className={
            isError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
          }
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
