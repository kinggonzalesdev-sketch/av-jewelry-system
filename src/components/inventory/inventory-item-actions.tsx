'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import { useRouter } from 'next/navigation';

import {
  deleteInventoryItemAction,
  forceDeleteInventoryItemAction,
  editInventoryItemAction,
  requestInventoryItemDeletionAction,
} from '@/lib/inventory/actions';
import { RequestDeletionButton } from '@/components/approvals/request-deletion-button';
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState,
} from '@/lib/inventory/action-state';
import type { InventoryRow } from '@/lib/inventory/service';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFieldFull, ModalFormGrid } from '@/components/ui/modal';

/**
 * Per-row Inventory actions: View · Edit · Delete, each in a centered modal.
 *
 * View is a compact read-only card (Code · Status · Grams · Date Encoded). Delete
 * is a one-step permanent delete that requires typing DELETE (Owner request
 * 2026-07-24, superseding the old archive/reason/dependency flow); the database
 * still refuses to delete an item linked to any business record, and the modal
 * surfaces that block. Every write re-checks permission server-side.
 */

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ');
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function InventoryItemActions({
  row,
  canEdit,
  canDelete,
  canForceDelete = false,
}: {
  row: InventoryRow;
  /** Holds `inventory_edit` — shows the Edit action. */
  canEdit: boolean;
  /** Holds `inventory_delete` — shows the Delete action. */
  canDelete: boolean;
  /** SUPER ADMIN (owner) only — reveals the "Force delete" override inside the
   *  Delete modal when the normal delete is blocked by resolved records only. */
  canForceDelete?: boolean;
}) {
  const router = useRouter();
  const parsed = parseInventoryCode(row.itemCode);

  const [view, setView] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState('');

  // --- Edit (correct descriptive details) -----------------------------------
  const [editState, editAction, editing] = useActionState<InventoryActionState, FormData>(
    editInventoryItemAction,
    EMPTY_INVENTORY_STATE,
  );
  const lastEdit = useRef<string | null>(null);
  useEffect(() => {
    if (editState.success && editState.success !== lastEdit.current) {
      lastEdit.current = editState.success;
      setEdit(false);
      router.refresh();
    }
  }, [editState.success, router]);

  // --- Delete (one-step permanent, type DELETE) -----------------------------
  const [delState, delAction, deleting] = useActionState<InventoryActionState, FormData>(
    deleteInventoryItemAction,
    EMPTY_INVENTORY_STATE,
  );
  const lastDelete = useRef<string | null>(null);
  useEffect(() => {
    if (delState.success && delState.success !== lastDelete.current) {
      lastDelete.current = delState.success;
      setDel(false);
      router.refresh();
    }
  }, [delState.success, router]);

  // --- Force delete (Super Admin override; same type-DELETE confirm) ----------
  const [forceState, forceAction, forcing] = useActionState<
    InventoryActionState,
    FormData
  >(forceDeleteInventoryItemAction, EMPTY_INVENTORY_STATE);
  const lastForce = useRef<string | null>(null);
  useEffect(() => {
    if (forceState.success && forceState.success !== lastForce.current) {
      lastForce.current = forceState.success;
      setDel(false);
      router.refresh();
    }
  }, [forceState.success, router]);

  // The override appears only when the normal delete was refused because the item
  // is linked to records — and only for a Super Admin. The DB still refuses a real
  // order / payment / active hold / sale, so this can only clear resolved clutter.
  const showForce =
    canForceDelete && !!delState.error && /linked to/i.test(delState.error);

  const dateEncoded = row.createdAt
    ? new Date(row.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  return (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        onClick={() => setView(true)}
        data-testid={`inventory-view-${row.inventoryItemId}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        View
      </button>
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEdit(true)}
          data-testid={`inventory-edit-${row.inventoryItemId}`}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          Edit
        </button>
      ) : null}
      {/* Owner deletes directly; a non-owner Admin requests Owner approval (Approvals
          Phase 2). canForceDelete is the owner-only signal (both come from the page's
          owner check), so it doubles as "is the Owner". */}
      {canDelete ? (
        canForceDelete ? (
          <button
            type="button"
            onClick={() => {
              setConfirm('');
              setDel(true);
            }}
            data-testid={`inventory-delete-${row.inventoryItemId}`}
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            Delete
          </button>
        ) : (
          <RequestDeletionButton
            label={row.itemCode}
            entityNoun="item"
            testIdBase={`inventory-request-delete-${row.inventoryItemId}`}
            onRequest={(reason) =>
              requestInventoryItemDeletionAction(
                row.inventoryItemId,
                row.itemCode,
                reason,
              )
            }
          />
        )
      ) : null}

      {/* View — compact read-only detail. */}
      <Modal open={view} onClose={() => setView(false)} title="Inventory item" size="sm">
        <dl className="text-sm">
          <DetailRow
            label="Inventory Code"
            value={<span className="font-mono">{row.itemCode}</span>}
          />
          <DetailRow label="Status" value={humanizeStatus(row.availabilityStatus)} />
          <DetailRow label="Grams" value={row.gramsPerPiece ?? parsed.grams ?? '—'} />
          <DetailRow label="Date Encoded" value={dateEncoded} />
        </dl>
      </Modal>

      {/* Edit — correct descriptive details (never the price). */}
      <Modal
        open={edit}
        onClose={() => setEdit(false)}
        ariaLabel="Correct item details"
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEdit(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={`inventory-edit-form-${row.inventoryItemId}`}
              disabled={editing}
            >
              {editing ? 'Saving…' : 'Save corrections'}
            </Button>
          </>
        }
      >
        <form
          id={`inventory-edit-form-${row.inventoryItemId}`}
          action={editAction}
          className="space-y-3"
        >
          <input type="hidden" name="inventoryItemId" value={row.inventoryItemId} />
          <p className="text-xs text-muted-foreground">
            Code <span className="font-mono">{row.itemCode}</span>
          </p>
          <ModalFormGrid>
            <ModalFieldFull>
              <Label htmlFor={`ed-name-${row.inventoryItemId}`} className="text-xs">
                Item name
              </Label>
              <Input
                id={`ed-name-${row.inventoryItemId}`}
                name="itemName"
                required
                defaultValue={row.itemName ?? ''}
                className="mt-1 h-9"
              />
            </ModalFieldFull>
            {/* Facebook Name removed from this form (Owner request). Its stored
                value is preserved on save via a hidden field so it is never wiped. */}
            <input type="hidden" name="facebookName" value={row.facebookName ?? ''} />
            <div>
              <Label htmlFor={`ed-grams-${row.inventoryItemId}`} className="text-xs">
                Grams
              </Label>
              <Input
                id={`ed-grams-${row.inventoryItemId}`}
                name="grams"
                inputMode="decimal"
                defaultValue={row.gramsPerPiece ?? ''}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor={`ed-size-${row.inventoryItemId}`} className="text-xs">
                Size
              </Label>
              <Input
                id={`ed-size-${row.inventoryItemId}`}
                name="size"
                defaultValue={row.size ?? ''}
                className="mt-1 h-9"
              />
            </div>
            <ModalFieldFull>
              <Label htmlFor={`ed-supplier-${row.inventoryItemId}`} className="text-xs">
                Supplier name
              </Label>
              <Input
                id={`ed-supplier-${row.inventoryItemId}`}
                name="supplierName"
                defaultValue={row.supplierName ?? ''}
                className="mt-1 h-9"
              />
            </ModalFieldFull>
          </ModalFormGrid>
          {editState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {editState.error}
            </p>
          ) : null}
        </form>
      </Modal>

      {/* Delete — one-step permanent delete, type DELETE to confirm. */}
      <Modal
        open={del}
        onClose={() => setDel(false)}
        title="Permanently delete item"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDel(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              form={`inventory-delete-form-${row.inventoryItemId}`}
              disabled={deleting || confirm !== 'DELETE'}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <form
          id={`inventory-delete-form-${row.inventoryItemId}`}
          action={delAction}
          className="space-y-3"
        >
          <input type="hidden" name="inventoryItemId" value={row.inventoryItemId} />
          <p className="text-sm">
            Permanently delete <span className="font-mono">{row.itemCode}</span>? This
            cannot be undone.
          </p>
          <p className="text-xs text-muted-foreground">
            An item linked to any order, claim, or reservation cannot be deleted — its
            records are protected.
          </p>
          <div>
            <Label htmlFor={`del-confirm-${row.inventoryItemId}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`del-confirm-${row.inventoryItemId}`}
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {delState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {delState.error}
            </p>
          ) : null}
        </form>

        {/* Super Admin override — only after a normal delete is refused because the
            item is linked to records. The database still protects a real order,
            payment, active hold, layaway, or sale, so this only clears resolved
            clutter (e.g. a completed return review, a released reservation). */}
        {showForce ? (
          <div className="mt-3 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Super Admin override.</span>{' '}
              This item is held only by resolved records. You can force-delete it — items
              tied to a real order, payment, active hold, layaway, or sale stay protected.
            </p>
            <form
              id={`inventory-force-delete-form-${row.inventoryItemId}`}
              action={forceAction}
            >
              <input type="hidden" name="inventoryItemId" value={row.inventoryItemId} />
              <input type="hidden" name="confirm" value={confirm} />
            </form>
            <Button
              type="submit"
              variant="destructive"
              form={`inventory-force-delete-form-${row.inventoryItemId}`}
              disabled={forcing || confirm !== 'DELETE'}
              data-testid={`inventory-force-delete-${row.inventoryItemId}`}
            >
              {forcing ? 'Force deleting…' : 'Force delete (Super Admin)'}
            </Button>
            {forceState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {forceState.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
