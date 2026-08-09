'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import { useRouter } from 'next/navigation';

import {
  permanentlyDeleteCustomerAction,
  requestCustomerDeletionAction,
} from '@/lib/customers/actions';
import {
  EMPTY_CUSTOMER_STATE,
  type CustomerActionState,
} from '@/lib/customers/action-state';
import { CustomerMergeButton } from '@/components/customers/customer-merge-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Row action for a customer. An OWNER deletes directly — irreversible, type-DELETE,
 * and the database refuses it when any linked record exists (every FK is RESTRICT).
 * A non-owner Admin (canManage but not the Owner) instead REQUESTS the deletion
 * (Approvals Phase 2, 2026-08-09): it goes to the Owner's Approvals and deletes
 * nothing until the Owner approves + executes it. So the Owner's flow is unchanged;
 * only a non-owner now goes through approval.
 */
export function CustomerRowActions({
  customerId,
  customerName,
  canManage,
  isOwner = false,
}: {
  customerId: string;
  customerName: string;
  canManage: boolean;
  /** Owner deletes directly; a non-owner Admin requests approval instead. */
  isOwner?: boolean;
}) {
  const router = useRouter();

  // --- Owner: direct permanent delete -----------------------------------------
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [state, submit, pending] = useActionState<CustomerActionState, FormData>(
    permanentlyDeleteCustomerAction,
    EMPTY_CUSTOMER_STATE,
  );
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  // --- Non-owner: request the deletion for Owner approval ---------------------
  const [reqOpen, setReqOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqSent, setReqSent] = useState(false);

  const sendRequest = async () => {
    if (reqBusy) return;
    if (reason.trim().length === 0) {
      setReqError('Add a reason for the Owner.');
      return;
    }
    setReqBusy(true);
    setReqError(null);
    const res = await requestCustomerDeletionAction(customerId, customerName, reason);
    setReqBusy(false);
    if (!res.ok) {
      setReqError(res.error);
      return;
    }
    setReqSent(true);
  };

  if (!canManage) return null;

  // Non-owner Admin: Request deletion (goes to Owner Approvals).
  if (!isOwner) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setReason('');
            setReqError(null);
            setReqSent(false);
            setReqOpen(true);
          }}
          data-testid={`customer-request-delete-${customerId}`}
          className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          Request delete
        </button>
        <Modal
          open={reqOpen}
          onClose={() => setReqOpen(false)}
          title="Request customer deletion"
          description="Sent to the Owner for approval — nothing is deleted yet."
          size="sm"
          footer={
            reqSent ? (
              <Button type="button" onClick={() => setReqOpen(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setReqOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void sendRequest()}
                  disabled={reqBusy}
                  data-testid={`customer-request-delete-send-${customerId}`}
                >
                  {reqBusy ? 'Sending…' : 'Send request'}
                </Button>
              </>
            )
          }
        >
          {reqSent ? (
            <p className="text-sm text-emerald-600" data-testid="customer-request-delete-sent">
              Request sent. The Owner reviews it in Approvals — the customer is not deleted
              until then.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                Ask the Owner to permanently delete <strong>{customerName}</strong>. This deletes
                nothing now; the Owner approves it in Approvals.
              </p>
              <div>
                <Label htmlFor={`customer-req-reason-${customerId}`} className="text-xs">
                  Reason (for the Owner)
                </Label>
                <Input
                  id={`customer-req-reason-${customerId}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoComplete="off"
                  placeholder="Why should this customer be deleted?"
                  className="mt-1 h-9"
                />
              </div>
              {reqError ? (
                <p role="alert" className="text-sm text-destructive">
                  {reqError}
                </p>
              ) : null}
            </div>
          )}
        </Modal>
      </>
    );
  }

  // Owner: merge duplicates + direct permanent delete.
  return (
    <>
      <CustomerMergeButton survivorId={customerId} survivorName={customerName} />
      <button
        type="button"
        onClick={() => {
          setConfirm('');
          setOpen(true);
        }}
        data-testid={`customer-delete-${customerId}`}
        className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Permanently delete customer"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              form={`customer-delete-form-${customerId}`}
              disabled={pending || confirm !== 'DELETE'}
            >
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <form id={`customer-delete-form-${customerId}`} action={submit} className="space-y-3">
          <input type="hidden" name="customerId" value={customerId} />
          <p className="text-sm">
            Permanently delete <strong>{customerName}</strong>? This cannot be undone.
          </p>
          <p className="text-xs text-muted-foreground">
            A customer with any linked order, invoice, payment, or layaway cannot be deleted —
            its records are protected.
          </p>
          <div>
            <Label htmlFor={`customer-delete-confirm-${customerId}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`customer-delete-confirm-${customerId}`}
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
