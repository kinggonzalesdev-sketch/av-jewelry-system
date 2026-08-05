'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import { useRouter } from 'next/navigation';

import {
  deleteInventoryItemAction,
  editInventoryItemAction,
} from '@/lib/inventory/actions';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from '@/lib/inventory/action-state';
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
}: {
  row: InventoryRow;
  /** Holds `inventory_edit` — shows the Edit action. */
  canEdit: boolean;
  /** Holds `inventory_delete` — shows the Delete action. */
  canDelete: boolean;
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

  const dateEncoded = row.createdAt
    ? new Date(row.createdAt).toLocaleDateString()
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
      {canDelete ? (
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
      ) : null}

      {/* View — compact read-only detail. */}
      <Modal
        open={view}
        onClose={() => setView(false)}
        title="Inventory item"
        size="sm"
      >
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
            <Button type="submit" form={`inventory-edit-form-${row.inventoryItemId}`} disabled={editing}>
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
      </Modal>
    </div>
  );
}
