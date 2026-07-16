'use client';

import { useActionState, useState } from 'react';

import {
  decideRtsAction,
  openMigrationBatchAction,
  returnToAvailableAction,
  reviewDuplicateAction,
} from '@/lib/inventory/actions';
import type { InventoryActionState } from '@/lib/inventory/action-state';
import { EMPTY_INVENTORY_STATE } from '@/lib/inventory/action-state';
import type {
  DuplicateRow,
  InventoryRow,
  MigrationBatchRow,
  RtsRow,
} from '@/lib/inventory/service';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Inventory Ops, Returned-to-Stock, Customers & Migration (Bible §19, §10).
 *
 * The screen states exactly what the database enforces:
 *   - Stock returns only via an APPROVED review; eligibility is not approval.
 *   - A review DECIDES; it never promotes a miner or allocates a waitlist.
 *   - A forfeited item is excluded from automatic return.
 *   - Judging two customers duplicates merges NOTHING.
 */

const TABS = [
  'Inventory',
  'Returned-to-Stock Review',
  'Duplicate Review',
  'Migration',
] as const;

type Tab = (typeof TABS)[number];

/** Provisional (§19.26): the outcome vocabulary is not client-final. */
const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: 'returned_to_available', label: 'Return to available' },
  { value: 'offered_to_second_miner_for_review', label: 'Offer to 2nd miner (review)' },
  { value: 'sent_to_waitlist_for_review', label: 'Send to waitlist (review)' },
  { value: 'held_unavailable', label: 'Hold unavailable' },
];

export function InventoryWorkspace({
  inventory,
  reviews,
  duplicates,
  batches,
  canMonitor,
  canReview,
  canMigrate,
}: {
  inventory: InventoryRow[];
  reviews: RtsRow[];
  duplicates: DuplicateRow[];
  batches: MigrationBatchRow[];
  canMonitor: boolean;
  canReview: boolean;
  canMigrate: boolean;
}) {
  const [tab, setTab] = useState<Tab>('Inventory');

  const [rtsState, rtsAction, deciding] = useActionState<InventoryActionState, FormData>(
    decideRtsAction,
    EMPTY_INVENTORY_STATE,
  );
  const [returnState, returnAction, returning] = useActionState<
    InventoryActionState,
    FormData
  >(returnToAvailableAction, EMPTY_INVENTORY_STATE);
  const [dupeState, dupeAction, reviewing] = useActionState<
    InventoryActionState,
    FormData
  >(reviewDuplicateAction, EMPTY_INVENTORY_STATE);
  const [batchState, batchAction, opening] = useActionState<
    InventoryActionState,
    FormData
  >(openMigrationBatchAction, EMPTY_INVENTORY_STATE);

  const notices = [rtsState, returnState, dupeState, batchState];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            size="sm"
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      {notices.map((n, i) =>
        n.error ? (
          <p key={`e${i}`} role="alert" className="text-sm text-destructive">
            {n.error}
          </p>
        ) : null,
      )}
      {notices.map((n, i) =>
        n.success ? (
          <p key={`s${i}`} className="text-sm text-muted-foreground">
            {n.success}
          </p>
        ) : null,
      )}

      {tab === 'Inventory' ? (
        inventory.length === 0 ? (
          <EmptyState title="No inventory items" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-2">Item</th>
                  <th className="px-2.5 py-2">Status</th>
                  <th className="px-2.5 py-2 text-right">Total</th>
                  <th className="px-2.5 py-2 text-right">Available</th>
                  <th className="px-2.5 py-2 text-right">Reserved</th>
                  <th className="px-2.5 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {inventory.map((i) => (
                  <tr key={i.inventoryItemId}>
                    <td className="px-2.5 py-2">
                      <span className="font-mono">{i.itemCode}</span>
                      {i.itemName ? ` · ${i.itemName}` : ''}
                    </td>
                    <td className="px-2.5 py-2">
                      {i.availabilityStatus.replace(/_/g, ' ')}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {i.quantityTotal}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {i.availableQuantity}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {i.reservedQuantity}
                    </td>
                    <td className="px-2.5 py-2 text-muted-foreground">
                      {i.inRtsReview ? 'In RTS review' : ''}
                      {i.isForfeited ? ' · forfeited (excluded from auto-return)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Available is derived from reservations, never a stored counter — a counter
              drifts, and drift means double-selling.
            </p>
          </div>
        )
      ) : null}

      {tab === 'Returned-to-Stock Review' ? (
        reviews.length === 0 ? (
          <EmptyState
            title="Nothing in Returned-to-Stock Review"
            description="Withdrawals, cancellations, and rejections arrive here for a human decision."
          />
        ) : (
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold">
                          {r.itemCode}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.triggerKind.replace(/_/g, ' ')} · qty {r.quantity}
                        </p>
                      </div>
                      <span className="rounded-full border px-2 py-0.5 text-xs">
                        {r.status.replace(/_/g, ' ')}
                        {r.freedUnitOutcome
                          ? ` · ${r.freedUnitOutcome.replace(/_/g, ' ')}`
                          : ''}
                      </span>
                    </div>

                    {canMonitor && r.status === 'in_review' ? (
                      <form action={rtsAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="reviewId" value={r.id} />
                        <div>
                          <Label htmlFor={`out-${r.id}`} className="text-xs">
                            Freed unit outcome
                          </Label>
                          <select
                            id={`out-${r.id}`}
                            name="freedUnitOutcome"
                            required
                            className="h-8 rounded-md border bg-background px-2 text-xs"
                          >
                            {OUTCOMES.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Button
                          type="submit"
                          name="decision"
                          value="approved_return"
                          size="sm"
                          disabled={deciding}
                        >
                          Approve Return
                        </Button>
                        <Button
                          type="submit"
                          name="decision"
                          value="rejected_held"
                          size="sm"
                          variant="destructive"
                          disabled={deciding}
                        >
                          Reject &amp; Hold
                        </Button>
                      </form>
                    ) : null}

                    {canMonitor && r.status === 'approved_return' ? (
                      <form action={returnAction}>
                        <input
                          type="hidden"
                          name="inventoryItemId"
                          value={r.inventoryItemId}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={returning}
                        >
                          Return to Available
                        </Button>
                      </form>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      A review decides and records; it never promotes a 2nd miner or
                      allocates from the waitlist. Offering to the 2nd miner is a review,
                      not a gift. Approving authorises the return — performing it is a
                      separate step.
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'Duplicate Review' ? (
        duplicates.length === 0 ? (
          <EmptyState
            title="No possible duplicates"
            description="Possible duplicate customers are flagged for review. Nothing is ever merged automatically."
          />
        ) : (
          <ul className="space-y-2">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <p className="text-sm font-semibold">
                      {d.customerName} <span className="font-normal">vs</span>{' '}
                      {d.duplicateName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.status.replace(/_/g, ' ')}
                    </p>

                    {canReview && d.status === 'open' ? (
                      <form
                        action={dupeAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="referenceId" value={d.id} />
                        <Button
                          type="submit"
                          name="judgement"
                          value="reviewed_distinct"
                          size="sm"
                          variant="outline"
                          disabled={reviewing}
                        >
                          Distinct customers
                        </Button>
                        <Button
                          type="submit"
                          name="judgement"
                          value="reviewed_duplicate"
                          size="sm"
                          variant="outline"
                          disabled={reviewing}
                        >
                          Same customer
                        </Button>
                      </form>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      Recording a judgement merges nothing — not even &quot;same
                      customer&quot;. Merge mechanics are deferred, and a silent merge
                      would rewrite whose order is whose.
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'Migration' ? (
        <div className="space-y-3">
          {canMigrate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open a migration batch</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={batchAction} className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label htmlFor="label" className="text-xs">
                      Label
                    </Label>
                    <Input id="label" name="label" required className="h-8 w-40" />
                  </div>
                  <div>
                    <Label htmlFor="source" className="text-xs">
                      Source description
                    </Label>
                    <Input
                      id="source"
                      name="sourceDescription"
                      required
                      placeholder="Where did these records come from?"
                      className="h-8 w-64"
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={opening}>
                    Open Batch
                  </Button>
                </form>
                <p className="mt-2 text-xs text-muted-foreground">
                  Migration is separate from live intake. A migrated record carries its
                  batch and preserves its historical values — no fake claim is created.
                </p>
              </CardContent>
            </Card>
          ) : (
            <p className="text-xs text-muted-foreground">
              Migration requires the Existing Record Entry permission.
            </p>
          )}

          {batches.length === 0 ? (
            <EmptyState title="No migration batches" />
          ) : (
            <ul className="space-y-2">
              {batches.map((b) => (
                <li key={b.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{b.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.sourceDescription}
                        </p>
                      </div>
                      <span className="rounded-full border px-2 py-0.5 text-xs">
                        {b.status.replace(/_/g, ' ')}
                        {b.recordCount !== null ? ` · ${b.recordCount} records` : ''}
                      </span>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
