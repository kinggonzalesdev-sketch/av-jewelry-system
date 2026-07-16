'use client';

import { useActionState } from 'react';

import {
  EMPTY_ACTION_STATE,
  createLiveBatchAction,
  transitionLiveBatchAction,
  type ActionState,
} from '@/lib/live/actions';
import type { LiveBatchItemRow } from '@/lib/live/batches';
import { LIVE_BATCH_ALLOWED_TRANSITIONS } from '@/lib/validation/live';
import { LiveCapturePanel } from '@/components/live/live-capture-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/states/empty-state';

export type LiveBatchRow = {
  id: string;
  batchReference: string;
  title: string;
  status: string;
};

/**
 * Live Batches (Bible §12, §22.4).
 *
 * Real, database-backed. The controls shown here are a CONVENIENCE only: every
 * transition is re-authorized and re-validated server-side, so hiding a button
 * is never what stops an action (Bible §11, ADR §7).
 *
 * `canOperate` / `canClose` come from the caller's actual grants and only
 * affect what is rendered.
 */
export function LiveBatchesView({
  batches,
  batchItems,
  customers,
  canOperate,
  canClose,
  canControlFlex,
  canCapture,
}: {
  batches: LiveBatchRow[];
  /** Items per batch id, for Current Flex Item control and capture. */
  batchItems: Record<string, LiveBatchItemRow[]>;
  customers: Array<{ id: string; displayName: string }>;
  canOperate: boolean;
  canClose: boolean;
  canControlFlex: boolean;
  canCapture: boolean;
}) {
  const [createState, createAction, creating] = useActionState<ActionState, FormData>(
    createLiveBatchAction,
    EMPTY_ACTION_STATE,
  );
  const [transitionState, transitionAction, transitioning] = useActionState<
    ActionState,
    FormData
  >(transitionLiveBatchAction, EMPTY_ACTION_STATE);

  return (
    <div className="space-y-4">
      {canOperate ? (
        <Card>
          <CardHeader>
            <CardTitle>Start a Live Batch</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createAction}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <Label htmlFor="title">Live Batch title</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  maxLength={160}
                  placeholder="Friday Live"
                />
              </div>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create draft'}
              </Button>
            </form>

            {createState.error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {createState.error}
              </p>
            ) : null}
            {createState.success ? (
              <p className="mt-2 text-sm text-muted-foreground">{createState.success}</p>
            ) : null}

            <p className="mt-2 text-xs text-muted-foreground">
              A new Live Batch starts as a draft. Creating one does not open it.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {transitionState.error ? (
        <p role="alert" className="text-sm text-destructive">
          {transitionState.error}
        </p>
      ) : null}
      {transitionState.success ? (
        <p className="text-sm text-muted-foreground">{transitionState.success}</p>
      ) : null}

      {batches.length === 0 ? (
        <EmptyState
          title="No Live Batches yet"
          description={
            canOperate
              ? 'Create a draft above to get started.'
              : 'You do not have the Live Batch Operation permission.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {batches.map((batch) => {
            const allowed = LIVE_BATCH_ALLOWED_TRANSITIONS[batch.status] ?? [];

            return (
              <li key={batch.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{batch.title}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {batch.batchReference} · {batch.status.replace('_', ' ')}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {allowed.map((transition) => {
                        const needsClosure = transition === 'close';
                        if (needsClosure && !canClose) return null;
                        if (!needsClosure && !canOperate) return null;

                        return (
                          <form key={transition} action={transitionAction}>
                            <input type="hidden" name="liveBatchId" value={batch.id} />
                            <input type="hidden" name="transition" value={transition} />
                            <Button
                              type="submit"
                              size="sm"
                              variant={needsClosure ? 'destructive' : 'outline'}
                              disabled={transitioning}
                            >
                              {transition}
                            </Button>
                          </form>
                        );
                      })}

                      {batch.status === 'closed' ? (
                        <span className="text-xs text-muted-foreground">
                          Closed. Reopening requires Owner approval.
                        </span>
                      ) : null}
                    </div>
                  </CardContent>

                  {/* Current Flex Item control and capture live with the batch
                      they belong to. Rendered only for an open batch, and only
                      for a caller holding one of the two permissions — both of
                      which are re-checked server-side at execution. */}
                  {(canControlFlex || canCapture) && batch.status !== 'closed' && (
                    <CardContent className="pt-0">
                      <LiveCapturePanel
                        liveBatchId={batch.id}
                        batchStatus={batch.status}
                        items={batchItems[batch.id] ?? []}
                        customers={customers}
                        canControlFlex={canControlFlex}
                        canCapture={canCapture}
                      />
                    </CardContent>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
