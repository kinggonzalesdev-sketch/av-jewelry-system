'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import { useRouter } from 'next/navigation';

import {
  checkItemDependenciesAction,
  permanentlyDeleteInventoryItemAction,
  restoreInventoryItemAction,
} from '@/lib/inventory/actions';
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState,
} from '@/lib/inventory/action-state';
import type {
  ArchivedInventoryResult,
  ArchivedInventoryRow,
  ItemDependency,
} from '@/lib/inventory/archive';
import { EmptyState } from '@/components/states/empty-state';
import { ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Archived / Deleted Items (Inventory Safe-Delete spec §5/§6/§8). DISTINCT from
 * Completed Items: these are incorrect / duplicate / test records, not sales.
 * Authorized users may Restore; the Owner may Permanently Delete an isolated,
 * dependency-free record. Every write re-checks permission server-side.
 */

const REASON_LABEL: Record<string, string> = {
  incorrectly_encoded: 'Incorrectly encoded',
  duplicate_entry: 'Duplicate entry',
  test_record: 'Test record',
  wrong_excel_import: 'Wrong Excel import',
  other: 'Other',
};

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

export function ArchivedItemsView({
  archived,
  canMonitor,
  isOwner,
}: {
  archived: ArchivedInventoryResult;
  canMonitor: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [restoreRow, setRestoreRow] = useState<ArchivedInventoryRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ArchivedInventoryRow | null>(null);

  const [restoreState, restoreAction, restoring] = useActionState<
    InventoryActionState,
    FormData
  >(restoreInventoryItemAction, EMPTY_INVENTORY_STATE);
  const lastRestore = useRef<string | null>(null);
  useEffect(() => {
    if (restoreState.success && restoreState.success !== lastRestore.current) {
      lastRestore.current = restoreState.success;
      setRestoreRow(null);
      router.refresh();
    }
  }, [restoreState.success, router]);

  const [deleteState, deleteAction, deleting] = useActionState<
    InventoryActionState,
    FormData
  >(permanentlyDeleteInventoryItemAction, EMPTY_INVENTORY_STATE);
  const lastDelete = useRef<string | null>(null);
  useEffect(() => {
    if (deleteState.success && deleteState.success !== lastDelete.current) {
      lastDelete.current = deleteState.success;
      setDeleteRow(null);
      router.refresh();
    }
  }, [deleteState.success, router]);

  // Dependencies for the permanent-delete modal.
  const [deps, setDeps] = useState<
    | { loading: true }
    | { loading: false; ok: true; rows: ItemDependency[] }
    | { loading: false; ok: false; error: string }
  >({ loading: true });
  useEffect(() => {
    if (!deleteRow) return;
    let cancelled = false;
    void checkItemDependenciesAction(deleteRow.inventoryItemId).then((res) => {
      if (cancelled) return;
      setDeps(
        res.ok
          ? { loading: false, ok: true, rows: res.dependencies }
          : { loading: false, ok: false, error: res.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [deleteRow]);

  if (!archived.ok) {
    return (
      <ReadError title="Archived items could not be loaded" detail={archived.reason} />
    );
  }
  if (archived.rows.length === 0) {
    return (
      <EmptyState
        title="No archived items"
        description="Incorrect, duplicate, or test records that are archived appear here. This is NOT the same as Completed Items (legitimate sales)."
      />
    );
  }

  const eligibleForDelete = deps.loading === false && deps.ok && deps.rows.length === 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Archived records are incorrect / duplicate / test items — never legitimate sales
        (those are Completed Items). Archiving is reversible; the record and every link
        are preserved.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table
          className="data-table data-table--stack w-full min-w-[860px] text-left text-xs"
          data-testid="archived-items"
        >
          <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left">Inventory Code</th>
              <th className="col-grow px-3 py-2.5 text-left">Item</th>
              <th className="px-3 py-2.5 text-left">Reason</th>
              <th className="px-3 py-2.5 text-left">Archived By</th>
              <th className="px-3 py-2.5 text-center">Archived</th>
              <th className="px-3 py-2.5 text-center">Original Status</th>
              <th className="col-actions px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {archived.rows.map((r) => (
              <tr key={r.inventoryItemId}>
                <td className="px-3 py-2.5 font-mono">{r.itemCode}</td>
                <td className="px-3 py-2.5">{r.itemName ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <span className="font-medium">
                    {REASON_LABEL[r.archiveReasonCode] ?? humanize(r.archiveReasonCode)}
                  </span>
                  {r.archiveReasonDetail ? (
                    <span className="block text-muted-foreground">
                      {r.archiveReasonDetail}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">{r.archivedByName ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center">
                  {r.archivedAt.slice(0, 10)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {humanize(r.archivedFromStatus)}
                </td>
                <td className="col-actions px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    {canMonitor ? (
                      <button
                        type="button"
                        onClick={() => setRestoreRow(r)}
                        data-testid={`archived-restore-${r.inventoryItemId}`}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                      >
                        Restore
                      </button>
                    ) : null}
                    {isOwner ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDeps({ loading: true });
                          setDeleteRow(r);
                        }}
                        data-testid={`archived-delete-${r.inventoryItemId}`}
                        className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Permanently Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Restore — requires a reason (spec §6). */}
      <Modal
        open={restoreRow !== null}
        onClose={() => setRestoreRow(null)}
        title="Restore archived item"
        description="Returns the item to its exact prior status. Blocked if another active item now uses the same code."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setRestoreRow(null)}>
              Cancel
            </Button>
            <Button type="submit" form="archived-restore-form" disabled={restoring}>
              {restoring ? 'Restoring…' : 'Confirm Restore'}
            </Button>
          </>
        }
      >
        {restoreRow ? (
          <form id="archived-restore-form" action={restoreAction} className="space-y-2">
            <input
              type="hidden"
              name="inventoryItemId"
              value={restoreRow.inventoryItemId}
            />
            <p className="text-sm">
              Restore <span className="font-mono">{restoreRow.itemCode}</span> to{' '}
              <span className="font-medium">
                {humanize(restoreRow.archivedFromStatus)}
              </span>
              .
            </p>
            <div>
              <Label htmlFor="restore-reason" className="text-xs">
                Restoration reason (required)
              </Label>
              <Input id="restore-reason" name="reason" required className="mt-1 h-9" />
            </div>
            {restoreState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {restoreState.error}
              </p>
            ) : null}
          </form>
        ) : null}
      </Modal>

      {/* Permanent delete — Owner only, dependency-free only (spec §4/§8). */}
      <Modal
        open={deleteRow !== null}
        onClose={() => setDeleteRow(null)}
        title="Permanently delete item"
        description="Irreversible. Allowed only for an isolated record with no connected business data."
        size="md"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDeleteRow(null)}>
              Cancel
            </Button>
            {eligibleForDelete ? (
              <Button
                type="submit"
                variant="destructive"
                form="archived-delete-form"
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Permanently Delete'}
              </Button>
            ) : null}
          </>
        }
      >
        {deleteRow ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-mono">{deleteRow.itemCode}</span> —{' '}
              {deleteRow.itemName ?? '—'}
            </p>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              This permanently removes the inventory row. The audit trail is preserved,
              but the record cannot be recovered.
            </div>

            {deps.loading ? (
              <p className="text-xs text-muted-foreground">Checking connected records…</p>
            ) : !deps.ok ? (
              <p role="alert" className="text-sm text-destructive">
                Connected-record check failed: {deps.error}
              </p>
            ) : deps.rows.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                <p className="mb-1 font-medium">Cannot delete — connected to:</p>
                <ul className="space-y-0.5">
                  {deps.rows.map((d, i) => (
                    <li key={`${d.kind}-${i}`}>
                      • {humanize(d.kind)} <span className="font-mono">{d.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                  It stays archived. Never break historical or financial links.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No connected records — this isolated item is eligible for permanent
                deletion.
              </p>
            )}

            <form id="archived-delete-form" action={deleteAction}>
              <input
                type="hidden"
                name="inventoryItemId"
                value={deleteRow.inventoryItemId}
              />
              {deleteState.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {deleteState.error}
                </p>
              ) : null}
            </form>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
