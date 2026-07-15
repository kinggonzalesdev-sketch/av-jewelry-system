'use client';

import { useActionState } from 'react';

import {
  EMPTY_ACTION_STATE,
  createLiveBatchAction,
  transitionLiveBatchAction,
  type ActionState,
} from '@/lib/live/actions';
import { LIVE_BATCH_ALLOWED_TRANSITIONS } from '@/lib/validation/live';
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
  canOperate,
  canClose,
}: {
  batches: LiveBatchRow[];
  canOperate: boolean;
  canClose: boolean;
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
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
