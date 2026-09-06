'use client';

import { useEffect, useMemo, useRef, useState, useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  deleteInventoryItemAction,
  forceDeleteInventoryItemAction,
  editInventoryItemAction,
  requestInventoryItemDeletionAction,
  requestInventoryEditAction,
} from '@/lib/inventory/actions';
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState,
} from '@/lib/inventory/action-state';
import type { InventoryRow } from '@/lib/inventory/service';
import { detectInventoryCodeIssues } from '@/lib/inventory/code-parser';
import { rowGramsDisplay } from '@/lib/inventory/grams-display';
import { isHKItem } from '@/lib/inventory/hk-item';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFieldFull, ModalFormGrid } from '@/components/ui/modal';

/**
 * Per-row Inventory actions: View · Edit · Delete (Owner request 2026-08-17).
 *
 * A **Super Admin (owner)** edits/deletes DIRECTLY. An **Admin** may only INITIATE — the
 * Edit/Delete buttons say "Submit for Approval": they create a Pending owner_approval_request
 * and mutate NOTHING. Only a Super Admin approves + executes it. The backend (server actions
 * + owner-only SECURITY DEFINER RPCs) is the real gate; hiding/relabelling here is convenience.
 */

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ');
}

/** Read a FormData field as a plain string (never a File → "[object Object]"). */
function fdStr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
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
  isOwner = false,
  canForceDelete = false,
  onMutated,
}: {
  row: InventoryRow;
  /** May INITIATE an edit (Owner → direct; Admin → approval request). */
  canEdit: boolean;
  /** May INITIATE a delete (Owner → direct; Admin → approval request). */
  canDelete: boolean;
  /** Super Admin (owner) — edits/deletes execute directly instead of requesting approval. */
  isOwner?: boolean;
  /** Super Admin only — reveals the "Force delete" override when a normal delete is blocked
   *  only by resolved records. */
  canForceDelete?: boolean;
  onMutated?: () => void;
}) {
  const router = useRouter();

  const [view, setView] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState('');
  // Admin request-flow state (edit/delete "Submit for Approval").
  const [requesting, startRequest] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Owner DIRECT edit -----------------------------------------------------
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
      onMutated?.();
    }
  }, [editState.success, router, onMutated]);

  // Super-Admin item_code CORRECTION — controlled so the save-time corruption guard warns live.
  // Reset to the current code each time the edit modal opens.
  const [codeVal, setCodeVal] = useState(row.itemCode);
  const codeIssues = useMemo(() => detectInventoryCodeIssues(codeVal), [codeVal]);
  // HK ITEM = fixed price, no grams (Owner 2026-09-02 BR2). Reactive to the code being edited so the
  // grams field auto-locks the moment the code becomes (or stops being) an HK ITEM.
  const isHk = isHKItem({ code: codeVal || row.itemCode || '', name: row.itemName });

  // --- Owner DIRECT delete ---------------------------------------------------
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
      onMutated?.();
    }
  }, [delState.success, router, onMutated]);

  // --- Force delete (Super Admin override) -----------------------------------
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
      onMutated?.();
    }
  }, [forceState.success, router, onMutated]);

  const showForce =
    isOwner && canForceDelete && !!delState.error && /linked to/i.test(delState.error);

  // --- Admin request submitters (Edit/Delete → Approval) ---------------------
  const submitEditRequest = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const proposed = {
      itemName: fdStr(fd, 'itemName'),
      grams: fdStr(fd, 'grams'),
      size: fdStr(fd, 'size'),
      supplierName: fdStr(fd, 'supplierName'),
      facebookName: fdStr(fd, 'facebookName'),
    };
    const reason = fdStr(fd, 'reason');
    startRequest(async () => {
      const res = await requestInventoryEditAction(row.inventoryItemId, proposed, reason);
      if (res.ok) {
        // Keep the modal OPEN and show the confirmation inside it (never as an inline cell
        // note — that would change the row height). The item is untouched until approval.
        setNote({ ok: true, text: 'Edit request submitted for Super Admin approval.' });
        router.refresh();
        onMutated?.();
      } else {
        setNote({ ok: false, text: res.error });
      }
    });
  };

  const submitDeleteRequest = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm !== 'DELETE') return;
    const reason = fdStr(new FormData(e.currentTarget), 'reason');
    startRequest(async () => {
      const res = await requestInventoryItemDeletionAction(
        row.inventoryItemId,
        row.itemCode,
        reason,
      );
      if (res.ok) {
        // Keep the modal OPEN and confirm inside it — the item stays until a Super Admin
        // approves, so nothing in the table changes (and the row height never shifts).
        setNote({ ok: true, text: 'Deletion request submitted for Super Admin approval.' });
        router.refresh();
        onMutated?.();
      } else {
        setNote({ ok: false, text: res.error });
      }
    });
  };

  const dateEncoded = row.createdAt
    ? new Date(row.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  // IDENTICAL labels for every role — Owner and Admin both see "Edit" / "Delete", so the
  // Actions column has the same width, the buttons stay on ONE line, and the row keeps its
  // 36px height regardless of permission (Owner request 2026-08-18: Admin rows were taller
  // because the longer "Request Edit / Request Delete" labels wrapped). An Admin's action is
  // still a REQUEST, not a mutation — that is made explicit INSIDE the modal (title, body,
  // the "Submit for Approval" button, and the post-submit confirmation), never by widening
  // the compact table button.
  const editLabel = 'Edit';
  const deleteLabel = 'Delete';

  return (
    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
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
          onClick={() => {
            setNote(null);
            // Reset the editable code to the current value on every open. Previously done by
            // a setState-in-effect on `edit`; same behaviour, now at the event that opens it.
            setCodeVal(row.itemCode);
            setEdit(true);
          }}
          data-testid={`inventory-edit-${row.inventoryItemId}`}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          {editLabel}
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          onClick={() => {
            setConfirm('');
            setNote(null);
            setDel(true);
          }}
          data-testid={`inventory-delete-${row.inventoryItemId}`}
          className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          {deleteLabel}
        </button>
      ) : null}

      {/* View — compact read-only detail. */}
      <Modal open={view} onClose={() => setView(false)} title="Inventory item" size="sm">
        <dl className="text-sm">
          <DetailRow
            label="Inventory Code"
            value={<span className="font-mono">{row.itemCode}</span>}
          />
          <DetailRow label="Status" value={humanizeStatus(row.availabilityStatus)} />
          <DetailRow label="Grams" value={rowGramsDisplay(row.itemCode, row.gramsPerPiece, row.itemName)} />
          <DetailRow label="Date Encoded" value={dateEncoded} />
        </dl>
      </Modal>

      {/* Edit — Owner saves directly; Admin submits for approval (with before→proposed
          captured server-side). Never changes the price. */}
      <Modal
        open={edit}
        onClose={() => setEdit(false)}
        ariaLabel={isOwner ? 'Correct item details' : 'Request an inventory edit'}
        size="sm"
        critical
        footer={
          note?.ok ? (
            <Button
              type="button"
              onClick={() => {
                setEdit(false);
                setNote(null);
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setEdit(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={`inventory-edit-form-${row.inventoryItemId}`}
                disabled={editing || requesting}
              >
                {isOwner
                  ? editing
                    ? 'Saving…'
                    : codeIssues.length > 0
                      ? 'Save anyway'
                      : 'Save corrections'
                  : requesting
                    ? 'Submitting…'
                    : 'Submit for Approval'}
              </Button>
            </>
          )
        }
      >
        {note?.ok ? (
          <div
            role="status"
            data-testid={`inventory-request-note-${row.inventoryItemId}`}
            className="rounded-md border border-gold/40 bg-gold/5 p-3 text-sm text-gold-strong"
          >
            ✓ {note.text} You’ll find it under Approvals — the item is unchanged until a
            Super Admin approves.
          </div>
        ) : (
        <form
          id={`inventory-edit-form-${row.inventoryItemId}`}
          action={isOwner ? editAction : undefined}
          onSubmit={isOwner ? undefined : submitEditRequest}
          className="space-y-3"
        >
          <input type="hidden" name="inventoryItemId" value={row.inventoryItemId} />
          {isOwner ? (
            <div>
              <Label htmlFor={`ed-code-${row.inventoryItemId}`} className="text-xs">
                Item Code
              </Label>
              <Input
                id={`ed-code-${row.inventoryItemId}`}
                name="itemCode"
                required
                value={codeVal}
                onChange={(e) => setCodeVal(e.target.value)}
                className="mt-1 h-9 font-mono"
                autoComplete="off"
              />
              {/* Same save-time corruption guard as New Entry — warns LIVE about likely typos; the
                  operator can still "Save anyway". Only enforced server-side when the code changes. */}
              {codeIssues.length > 0 ? (
                <div
                  role="alert"
                  className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <p className="font-medium">Double-check this code:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {codeIssues.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <input
                type="hidden"
                name="acknowledgeWarning"
                value={codeIssues.length > 0 ? '1' : ''}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Code <span className="font-mono">{row.itemCode}</span>
              {' · your change is submitted to a Super Admin for approval.'}
            </p>
          )}
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
            <input type="hidden" name="facebookName" value={row.facebookName ?? ''} />
            <div>
              <Label htmlFor={`ed-grams-${row.inventoryItemId}`} className="text-xs">
                Grams
              </Label>
              {isHk ? (
                // BR2: an HK ITEM is Fixed Price — grams do not apply. The input is replaced by a
                // locked indicator and a hidden empty value, so saving keeps grams NULL (never a number).
                <>
                  <div className="mt-1 flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    Fixed Price — no grams
                  </div>
                  <input type="hidden" name="grams" value="" />
                </>
              ) : (
                <Input
                  id={`ed-grams-${row.inventoryItemId}`}
                  name="grams"
                  inputMode="decimal"
                  defaultValue={row.gramsPerPiece ?? ''}
                  className="mt-1 h-9"
                />
              )}
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
            {isOwner ? null : (
              <ModalFieldFull>
                <Label htmlFor={`ed-reason-${row.inventoryItemId}`} className="text-xs">
                  Reason for the Super Admin (optional)
                </Label>
                <Input
                  id={`ed-reason-${row.inventoryItemId}`}
                  name="reason"
                  placeholder="e.g. wrong grams encoded"
                  className="mt-1 h-9"
                />
              </ModalFieldFull>
            )}
          </ModalFormGrid>
          {editState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {editState.error}
            </p>
          ) : null}
          {note && !note.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {note.text}
            </p>
          ) : null}
        </form>
        )}
      </Modal>

      {/* Delete — Owner deletes directly (with force override); Admin submits for approval. */}
      <Modal
        open={del}
        onClose={() => setDel(false)}
        title={isOwner ? 'Permanently delete item' : 'Request item deletion'}
        description={
          isOwner ? 'This cannot be undone.' : 'A Super Admin must approve before it deletes.'
        }
        size="sm"
        critical
        footer={
          note?.ok ? (
            <Button
              type="button"
              onClick={() => {
                setDel(false);
                setNote(null);
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setDel(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                form={`inventory-delete-form-${row.inventoryItemId}`}
                disabled={deleting || requesting || confirm !== 'DELETE'}
              >
                {isOwner
                  ? deleting
                    ? 'Deleting…'
                    : 'Delete permanently'
                  : requesting
                    ? 'Submitting…'
                    : 'Submit for Approval'}
              </Button>
            </>
          )
        }
      >
        {note?.ok ? (
          <div
            role="status"
            data-testid={`inventory-request-note-${row.inventoryItemId}`}
            className="rounded-md border border-gold/40 bg-gold/5 p-3 text-sm text-gold-strong"
          >
            ✓ {note.text} You’ll find it under Approvals — the item stays until a Super
            Admin approves.
          </div>
        ) : (
        <form
          id={`inventory-delete-form-${row.inventoryItemId}`}
          action={isOwner ? delAction : undefined}
          onSubmit={isOwner ? undefined : submitDeleteRequest}
          className="space-y-3"
        >
          <input type="hidden" name="inventoryItemId" value={row.inventoryItemId} />
          <p className="text-sm">
            {isOwner ? 'Permanently delete ' : 'Request deletion of '}
            <span className="font-mono">{row.itemCode}</span>?
            {isOwner ? ' This cannot be undone.' : ' The item stays until a Super Admin approves.'}
          </p>
          <p className="text-xs text-muted-foreground">
            An item linked to any order, claim, or reservation cannot be deleted — its
            records are protected (re-checked at approval time).
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
          {isOwner ? null : (
            <div>
              <Label htmlFor={`del-reason-${row.inventoryItemId}`} className="text-xs">
                Reason for the Super Admin (optional)
              </Label>
              <Input
                id={`del-reason-${row.inventoryItemId}`}
                name="reason"
                placeholder="e.g. duplicate / mis-encoded"
                className="mt-1 h-9"
              />
            </div>
          )}
          {delState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {delState.error}
            </p>
          ) : null}
          {note && !note.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {note.text}
            </p>
          ) : null}
        </form>
        )}

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
